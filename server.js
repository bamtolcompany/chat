const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- '로컬 채팅' 데이터 구조 ---
const NICKNAMES_FILE = path.join(__dirname, 'nicknames.json');
let usedNicknamesByIp = {};
let activeNicknamesByIp = {};
const MAX_HISTORY_LENGTH = 100;
let chatHistoryByIp = {};

// --- '오픈 채팅' 데이터 구조 ---
let openChatRooms = {};
let openChatActiveUsers = new Map(); // socket.id -> user info

// --- 서버 초기화 ---
try {
    const localNicknamesData = fs.readFileSync(NICKNAMES_FILE, 'utf8');
    usedNicknamesByIp = localNicknamesData ? JSON.parse(localNicknamesData) : {};
} catch (e) {
    if (e.code !== 'ENOENT') console.error("로컬 닉네임 파일을 읽는 데 실패했습니다:", e);
    usedNicknamesByIp = {};
}
openChatRooms = db.loadRooms();

function saveLocalNicknames() {
    try {
        fs.writeFileSync(NICKNAMES_FILE, JSON.stringify(usedNicknamesByIp));
    } catch (e) {
        console.error("로컬 닉네임 파일 저장 실패:", e.message, "이 환경에서는 파일 영속성이 작동하지 않을 수 있습니다.");
    }
}
function saveOpenChatRooms() {
    try {
        db.saveRooms(openChatRooms);
    } catch (e) {
        console.error("오픈 채팅방 데이터 저장 실패:", e.message, "이 환경에서는 파일 영속성이 작동하지 않을 수 있습니다.");
    }
}

app.use(express.static('public'));

// Helper function to get users in a specific room
function getUsersInRoom(roomId) {
    const users = [];
    for (const [id, user] of openChatActiveUsers.entries()) {
        if (user.currentRoom === roomId) {
            users.push({ id: user.id, nickname: user.nickname });
        }
    }
    return users;
}

io.on('connection', (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    console.log(`a user connected from ${ip}`);
    socket.ip = ip;
    socket.userId = null; // 초기에는 userId가 없음. set nickname에서 설정됨.

    // 'local' 모드 데이터 초기화
    if (!activeNicknamesByIp[ip]) activeNicknamesByIp[ip] = new Set();
    if (!chatHistoryByIp[ip]) chatHistoryByIp[ip] = [];
    if (!usedNicknamesByIp[ip]) usedNicknamesByIp[ip] = [];

    // --- 공통 이벤트 ---
    socket.on('disconnect', () => {
        const user = openChatActiveUsers.get(socket.id);
        if (user && user.currentRoom) {
            const roomId = user.currentRoom;
            const room = openChatRooms[roomId];
            if (room) {
                const systemMessage = { type: 'system', message: `"${user.nickname}"님이 나갔습니다.` };
                room.history.push(systemMessage);
                io.to(roomId).emit('chat message', systemMessage);
                
                // 유저 목록 갱신
                // 연결이 끊긴 유저를 openChatActiveUsers에서 제거한 후에 호출해야 정확한 목록이 감
                openChatActiveUsers.delete(socket.id); 
                const usersInRoom = getUsersInRoom(roomId);
                io.to(roomId).emit('room user list update', usersInRoom);
            }

        } else if (socket.chatMode === 'local' && socket.nickname) {
            const roomName = socket.ip;
            activeNicknamesByIp[roomName].delete(socket.nickname);
            const systemMessage = { type: 'system', message: `"${socket.nickname}"님이 나갔습니다.` };
            chatHistoryByIp[roomName].push(systemMessage);
            io.to(roomName).emit('chat message', systemMessage);
        } else if (!user && socket.chatMode === 'open') { // user가 없고, open chat인 경우 (아직 닉네임 설정 안했거나)
            openChatActiveUsers.delete(socket.id); // 혹시 모를 잔여 데이터 정리
        }
        console.log(`user from ${ip} disconnected.`);
    });

    socket.on('set nickname', ({ nickname, mode, userId }, callback) => {
        socket.chatMode = mode;
        socket.nickname = nickname; 
        socket.userId = userId; // 소켓 객체에 userId 저장

        if (mode === 'local') {
            const roomName = socket.ip;
            if (activeNicknamesByIp[roomName].has(nickname)) {
                return callback({ success: false, message: '이미 다른 사용자가 접속해 있는 닉네임입니다.' });
            }
            if (!usedNicknamesByIp[roomName].includes(nickname)) {
                usedNicknamesByIp[roomName].push(nickname);
                saveLocalNicknames();
            }
            activeNicknamesByIp[roomName].add(nickname);
            socket.join(roomName);
            socket.emit('chat history', chatHistoryByIp[roomName]);
            callback({ success: true });
            const systemMessage = { type: 'system', message: `"${nickname}"님이 입장했습니다.` };
            chatHistoryByIp[roomName].push(systemMessage);
            io.to(roomName).emit('chat message', systemMessage);
        } else if (mode === 'open') {
            // 오픈 채팅에서는 닉네임 중복을 허용할 것인지, 아니면 전체에서 유니크해야 할 것인지 결정 필요
            // 현재는 방 내부에서만 닉네임 유효성 검사를 하므로 여기서는 통과
            openChatActiveUsers.set(socket.id, { id: userId, nickname, currentRoom: null });
            callback({ success: true, action: 'show_lobby' });
        } else {
            callback({ success: false, message: '알 수 없는 채팅 모드입니다.' });
        }
    });
    
    socket.on('chat message', ({ message, roomId }) => {
        if (socket.chatMode === 'local') {
            const roomName = socket.ip;
            const chatMessage = { type: 'chat', nickname: socket.nickname, message };
            chatHistoryByIp[roomName].push(chatMessage);
            io.to(roomName).emit('chat message', chatMessage);
        } else if (socket.chatMode === 'open') {
            const user = openChatActiveUsers.get(socket.id);
            if (!user || !roomId) return;
            const room = openChatRooms[roomId];
            if (!room || !socket.rooms.has(roomId)) return;

            const chatMessage = { type: 'chat', nickname: user.nickname, message, mentions: [] };
            
            // 멘션 파싱
            const mentionedNicknames = message.match(/@([^\s]+)/g);
            if (mentionedNicknames) {
                // 현재 방에 있는 모든 유저 목록 (닉네임으로 userId 찾기 위함)
                const usersInRoom = Array.from(openChatActiveUsers.values()).filter(u => u.currentRoom === roomId);
                mentionedNicknames.forEach(mention => {
                    const mentionedNickname = mention.substring(1); // @ 제거
                    const mentionedUser = usersInRoom.find(u => u.nickname === mentionedNickname);
                    if (mentionedUser) {
                        chatMessage.mentions.push(mentionedUser.id);
                        // 언급된 사용자에게만 특별 이벤트 발송 (접속해 있는 경우)
                        for (const [sId, activeUser] of openChatActiveUsers.entries()) {
                            if (activeUser.id === mentionedUser.id && activeUser.currentRoom === roomId) {
                                io.to(sId).emit('mentioned', { 
                                    message: chatMessage, 
                                    roomId: room.id, 
                                    roomName: room.name 
                                });
                                break; 
                            }
                        }
                    }
                });
            }

            room.history.push(chatMessage);
            if(room.history.length > MAX_HISTORY_LENGTH) room.history.shift();
            io.to(roomId).emit('chat message', chatMessage); // 모든 방 사용자에게 메시지 전송
        }
    });

    // --- 오픈 채팅 이벤트 ---
    socket.on('get rooms', () => {
        const user = openChatActiveUsers.get(socket.id);
        // 로비에 접속하는 모든 유저에게 방 목록을 보냄. (user가 없어도 로비는 볼 수 있어야 함)
        // user가 있을 경우에만 자신의 삭제된 방을 볼 수 있음.

        const roomsListForClient = {};
        for (const roomId in openChatRooms) {
            const room = openChatRooms[roomId];
            
            // 삭제되지 않은 방은 항상 표시
            if (!room.deletedAt) {
                roomsListForClient[roomId] = {
                    id: room.id,
                    name: room.name,
                    owner: room.owner,
                    deletedAt: room.deletedAt,
                    isOwner: (user && room.owner === user.id)
                };
            } else if (user && room.owner === user.id) {
                // 방장에게는 자신의 삭제된 방도 표시 (복구를 위해)
                 roomsListForClient[roomId] = {
                    id: room.id,
                    name: room.name,
                    owner: room.owner,
                    deletedAt: room.deletedAt,
                    isOwner: true
                };
            }
        }
        socket.emit('rooms list', roomsListForClient);
    });

    socket.on('create room', ({ roomName }) => {
        const newRoomId = crypto.randomUUID();
        const user = openChatActiveUsers.get(socket.id);
        if (!user) {
            socket.emit('create room failed', { message: '닉네임 설정 후 방을 만들 수 있습니다.' });
            return; 
        }

        // 닉네임 중복 체크 (전체 오픈 채팅방 내에서) - 필요하면 추가
        // 현재는 방 내부에서만 닉네임 유효성 검사를 하므로 여기서는 통과

        const newRoom = {
            id: newRoomId,
            name: roomName,
            owner: user.id, // user.id를 방의 소유자로 설정
            history: [],
            bannedUsers: [],
            deletedAt: null,
        };
        openChatRooms[newRoomId] = newRoom;
        saveOpenChatRooms();
        
        const roomsListForClient = {};
        for (const rId in openChatRooms) {
            const r = openChatRooms[rId];
            roomsListForClient[rId] = {
                id: r.id,
                name: r.name,
                owner: r.owner,
                deletedAt: r.deletedAt,
                isOwner: (user && r.owner === user.id)
            };
        }
        io.emit('rooms list', roomsListForClient);
    });
    
    socket.on('join room', ({ roomId }) => {
        const room = openChatRooms[roomId];
        const user = openChatActiveUsers.get(socket.id);
        if (!room || !user) return;
        
        // 차단된 사용자인지 확인
        if (room.bannedUsers.includes(user.id)) {
            socket.emit('join room failed', { message: '이 방에서 차단되었습니다.' });
            return;
        }

        // 삭제된 방인지 확인 (방장 본인은 접속 가능해야 함)
        if (room.deletedAt && room.owner !== user.id) {
            socket.emit('join room failed', { message: '삭제된 방입니다.' });
            return;
        }


        // 이전 방이 있었다면 나가기 처리 및 유저리스트 갱신
        if(user.currentRoom && user.currentRoom !== roomId) {
            const oldRoom = openChatRooms[user.currentRoom];
            if(oldRoom) {
                const leaveMessage = { type: 'system', message: `"${user.nickname}"님이 나갔습니다.` };
                oldRoom.history.push(leaveMessage);
                socket.to(user.currentRoom).emit('chat message', leaveMessage);
                io.to(user.currentRoom).emit('room user list update', getUsersInRoom(user.currentRoom));
            }
            socket.leave(user.currentRoom);
        }

        socket.join(roomId);
        user.currentRoom = roomId;
        
        const isOwner = room.owner === user.id;
        socket.emit('join room success', { room, history: room.history, isOwner });
        
        const systemMessage = { type: 'system', message: `"${user.nickname}"님이 입장했습니다.` };
        room.history.push(systemMessage);
        socket.to(roomId).emit('chat message', systemMessage);

        // 현재 방의 유저 목록 전송
        const usersInRoom = getUsersInRoom(roomId);
        io.to(roomId).emit('room user list update', usersInRoom);
    });

    socket.on('ban user', ({ userIdToBan, roomId }) => {
        const room = openChatRooms[roomId];
        const adminUser = openChatActiveUsers.get(socket.id);

        if (!room || !adminUser || room.owner !== adminUser.id) {
            socket.emit('ban failed', { message: '차단 권한이 없습니다.' });
            return;
        }

        if (room.bannedUsers.includes(userIdToBan)) {
            socket.emit('ban failed', { message: '이미 차단된 사용자입니다.' });
            return;
        }

        if (userIdToBan === adminUser.id) {
            socket.emit('ban failed', { message: '자기 자신을 차단할 수 없습니다.' });
            return;
        }

        room.bannedUsers.push(userIdToBan);
        saveOpenChatRooms();

        let bannedUserNickname = "알 수 없는 사용자";
        for (const [sId, user] of openChatActiveUsers.entries()) {
            if (user.id === userIdToBan) {
                bannedUserNickname = user.nickname;
                const bannedSocket = io.sockets.sockets.get(sId);
                if (bannedSocket) {
                    bannedSocket.emit('banned', { roomId: room.id, roomName: room.name, message: `"${room.name}" 방에서 차단되었습니다.` });
                    bannedSocket.leave(room.id);
                    user.currentRoom = null;
                }
                break;
            }
        }
        
        const systemMessage = { type: 'system', message: `"${bannedUserNickname}"님이 방장에 의해 차단되었습니다.` };
        room.history.push(systemMessage);
        io.to(roomId).emit('chat message', systemMessage);
        
        io.to(roomId).emit('room user list update', getUsersInRoom(roomId));

        socket.emit('ban success', { message: `"${bannedUserNickname}"님을 성공적으로 차단했습니다.` });
    });

    socket.on('delete room', ({ roomId }) => {
        const room = openChatRooms[roomId];
        const adminUser = openChatActiveUsers.get(socket.id);

        if (!room || !adminUser || room.owner !== adminUser.id) {
            socket.emit('delete failed', { message: '방 삭제 권한이 없습니다.' });
            return;
        }

        room.deletedAt = Date.now();
        saveOpenChatRooms();

        const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (clientsInRoom) {
            for (const clientId of clientsInRoom) {
                const clientSocket = io.sockets.sockets.get(clientId);
                if (clientSocket) {
                    clientSocket.emit('room deleted', { roomId: room.id, roomName: room.name, message: `"${room.name}" 방이 방장에 의해 삭제되었습니다.` });
                    clientSocket.leave(room.id);
                    const user = openChatActiveUsers.get(clientSocket.id);
                    if (user) user.currentRoom = null;
                }
            }
        }
        const systemMessage = { type: 'system', message: `"${room.name}" 방이 방장에 의해 삭제되었습니다.` };
        room.history.push(systemMessage); 
        
        const roomsListForClient = {};
        for (const rId in openChatRooms) {
            const r = openChatRooms[rId];
            roomsListForClient[rId] = {
                id: r.id,
                name: r.name,
                owner: r.owner,
                deletedAt: r.deletedAt,
                isOwner: (adminUser && r.owner === adminUser.id)
            };
        }
        io.emit('rooms list', roomsListForClient);

        socket.emit('delete success', { message: `"${room.name}" 방을 성공적으로 삭제했습니다.` });
    });

    socket.on('restore room', ({ roomId }) => {
        const room = openChatRooms[roomId];
        const adminUser = openChatActiveUsers.get(socket.id);

        if (!room || !adminUser || room.owner !== adminUser.id) {
            socket.emit('restore failed', { message: '방 복구 권한이 없습니다.' });
            return;
        }

        if (!room.deletedAt) {
            socket.emit('restore failed', { message: '삭제된 방이 아닙니다.' });
            return;
        }

        const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
        if (Date.now() - room.deletedAt > SEVENTY_TWO_HOURS_MS) {
            socket.emit('restore failed', { message: '삭제 후 72시간이 지나 복구할 수 없습니다.' });
            return;
        }

        room.deletedAt = null; // 삭제 상태 해제
        saveOpenChatRooms();

        const roomsListForClient = {};
        for (const rId in openChatRooms) {
            const r = openChatRooms[rId];
            roomsListForClient[rId] = {
                id: r.id,
                name: r.name,
                owner: r.owner,
                deletedAt: r.deletedAt,
                isOwner: (adminUser && r.owner === adminUser.id)
            };
        }
        io.emit('rooms list', roomsListForClient);

        socket.emit('restore success', { message: `"${room.name}" 방을 성공적으로 복구했습니다.` });
    });
});