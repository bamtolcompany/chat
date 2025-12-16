const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const NICKNAMES_FILE = path.join(__dirname, 'nicknames.json');

// 이전에 사용된 닉네임 목록을 관리하는 변수 (영구 저장)
let usedNicknames = new Set();
// 현재 활성 중인 닉네임 목록 (메모리에만 저장)
let activeNicknames = new Set();
// 채팅 기록을 저장하는 배열
const MAX_HISTORY_LENGTH = 100;
let chatHistory = [];

// 서버 시작 시 파일에서 닉네임 목록을 읽어옵니다.
if (fs.existsSync(NICKNAMES_FILE)) {
    const data = fs.readFileSync(NICKNAMES_FILE, 'utf8');
    if (data) {
        usedNicknames = new Set(JSON.parse(data));
    }
}

// 닉네임 목록을 파일에 저장하는 함수
function saveNicknames() {
    fs.writeFileSync(NICKNAMES_FILE, JSON.stringify([...usedNicknames]));
}

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('user disconnected');
        if (socket.nickname) {
            // 활성 사용자 목록에서만 제거
            activeNicknames.delete(socket.nickname);
            const systemMessage = { type: 'system', message: `"${socket.nickname}"님이 나갔습니다.` };
            chatHistory.push(systemMessage);
            if (chatHistory.length > MAX_HISTORY_LENGTH) {
                chatHistory.shift();
            }
            io.emit('chat message', systemMessage);
        }
    });

    // 닉네임 설정 요청 처리
    socket.on('set nickname', (nickname, callback) => {
        // 현재 다른 사람이 사용 중인 경우
        if (activeNicknames.has(nickname)) {
            callback({ success: false, message: '이미 다른 사용자가 접속해 있는 닉네임입니다.' });
            return;
        }

        // 이전에 사용된 적이 없는 새로운 닉네임인 경우
        if (!usedNicknames.has(nickname)) {
            usedNicknames.add(nickname);
            saveNicknames();
        }

        // 닉네임 설정 성공
        socket.nickname = nickname;
        activeNicknames.add(nickname);

        // 클라이언트에게 채팅 기록 전송
        socket.emit('chat history', chatHistory);
        
        callback({ success: true });
        
        const systemMessage = { type: 'system', message: `"${nickname}"님이 입장했습니다.` };
        chatHistory.push(systemMessage);
        if (chatHistory.length > MAX_HISTORY_LENGTH) {
            chatHistory.shift();
        }
        io.emit('chat message', systemMessage);
    });

    // 채팅 메시지 처리
    socket.on('chat message', (msg) => {
        if (socket.nickname) {
            const chatMessage = { type: 'chat', nickname: socket.nickname, message: msg };
            chatHistory.push(chatMessage);
            if (chatHistory.length > MAX_HISTORY_LENGTH) {
                chatHistory.shift();
            }
            io.emit('chat message', chatMessage);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`채팅 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log('같은 Wi-Fi에 연결된 다른 기기에서는 브라우저 주소창에 서버 PC의 IP 주소를 입력하여 접속하세요.');
});
