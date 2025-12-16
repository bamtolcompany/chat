const socket = io();

// --- DOM Elements ---
const screens = {
    modeSelection: document.getElementById('mode-selection-container'),
    nickname: document.getElementById('nickname-container'),
    lobby: document.getElementById('lobby-container'),
    chat: document.getElementById('chat-container'),
};
const localChatButton = document.getElementById('local-chat-button');
const openChatButton = document.getElementById('open-chat-button');
const nicknameInput = document.getElementById('nickname-input');
const setNicknameButton = document.getElementById('set-nickname-button');
const nicknameError = document.getElementById('nickname-error');
const roomList = document.getElementById('room-list');
const createRoomForm = document.getElementById('create-room-form');
const roomNameInput = document.getElementById('room-name-input');
const chatRoomName = document.getElementById('chat-room-name');
const chatForm = document.getElementById('form');
const chatInput = document.getElementById('input');
const messages = document.getElementById('messages');
const userList = document.getElementById('user-list');
const deleteRoomButton = document.getElementById('delete-room-button');
const deletedRoomsContainer = document.getElementById('deleted-rooms-container');
const deletedRoomList = document.getElementById('deleted-room-list');

// --- State ---
const state = {
    chatMode: null,
    nickname: null,
    userId: null,
    currentRoom: null,
    isOwner: false,
};

// --- Functions ---
function getOrSetUserId() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = crypto.randomUUID();
        localStorage.setItem('userId', userId);
    }
    state.userId = userId;
    return userId;
}

function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.style.display = 'none');
    screens[screenName].style.display = 'block';
    if (screenName === 'chat') {
        screens.chat.style.display = 'flex';
    }
}

function addMessage(data) {
    const item = document.createElement('li');
    let messageText = data.message;

    // 멘션된 메시지 하이라이트
    if (data.mentions && data.mentions.includes(state.userId)) {
        item.classList.add('mentioned-message');
    }

    // 메시지 내 멘션된 닉네임을 찾아서 하이라이트 (선택 사항)
    // 현재는 전체 메시지를 하이라이트하는 것으로 충분
    
    if (data.type === 'system') {
        item.textContent = messageText;
        item.classList.add('system-message');
    } else {
        item.textContent = `${data.nickname}: ${messageText}`;
    }
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
}

function renderRoomList(rooms) {
    roomList.innerHTML = '';
    deletedRoomList.innerHTML = '';
    let hasDeletedRooms = false;

    for (const roomId in rooms) {
        const room = rooms[roomId];
        const li = document.createElement('li');
        li.dataset.roomId = room.id;

        if (room.deletedAt) {
            // 삭제된 방 처리 (방장에게만 표시 및 복구 버튼)
            if (room.isOwner) {
                hasDeletedRooms = true;
                li.innerHTML = `<span>${room.name} (삭제됨)</span>`;
                const restoreButton = document.createElement('button');
                restoreButton.textContent = '복구';
                restoreButton.className = 'restore-button';
                li.appendChild(restoreButton);
                deletedRoomList.appendChild(li);
            }
        } else {
            // 활성 방 처리
            li.textContent = room.name;
            roomList.appendChild(li);
        }
    }
    deletedRoomsContainer.style.display = hasDeletedRooms ? 'block' : 'none';
}

function renderUserList(users) {
    userList.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        let text = user.nickname;
        if (user.id === state.userId) {
            text += ' (나)';
        }
        
        const span = document.createElement('span');
        span.textContent = text;
        li.appendChild(span);

        if (state.isOwner && user.id !== state.userId) {
            const banButton = document.createElement('button');
            banButton.textContent = '차단';
            banButton.className = 'ban-button';
            banButton.dataset.userId = user.id;
            li.appendChild(banButton);
        }
        userList.appendChild(li);
    });
}

function setNickname() {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
        nicknameError.textContent = '닉네임을 입력해주세요.';
        return;
    }
    socket.emit('set nickname', { 
        nickname: nickname, 
        mode: state.chatMode,
        userId: state.userId
    }, (response) => {
        if (response.success) {
            state.nickname = nickname;
            localStorage.setItem('nickname', nickname);
            if (response.action === 'show_lobby') {
                showScreen('lobby');
                socket.emit('get rooms');
            } else {
                showScreen('chat');
            }
        } else {
            nicknameError.textContent = response.message;
        }
    });
}

function selectMode(mode) {
    state.chatMode = mode;
    showScreen('nickname');
    const savedNickname = localStorage.getItem('nickname');
    if (savedNickname) nicknameInput.value = savedNickname;
    nicknameInput.focus();
}

// --- Event Listeners ---
window.addEventListener('load', () => {
    getOrSetUserId();
    showScreen('modeSelection');
});

localChatButton.addEventListener('click', () => selectMode('local'));
openChatButton.addEventListener('click', () => selectMode('open'));
setNicknameButton.addEventListener('click', setNickname);
nicknameInput.addEventListener('keypress', (e) => e.key === 'Enter' && setNickname());

createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = roomNameInput.value.trim();
    if (roomName) {
        socket.emit('create room', { roomName });
        roomNameInput.value = '';
    }
});

roomList.addEventListener('click', (e) => {
    if (e.target && e.target.tagName === 'LI') {
        const roomId = e.target.dataset.roomId;
        socket.emit('join room', { roomId });
    }
});

deletedRoomList.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('restore-button')) {
        const roomId = e.target.parentNode.dataset.roomId;
        // openChatRooms 객체가 클라이언트에 없으므로 서버에서 받은 rooms를 사용
        // 이 부분은 roomList에 저장된 전체 rooms 객체를 사용해야 함
        // 임시방편으로 버튼 텍스트에서 방 이름 추출
        const roomNameFromText = e.target.parentNode.querySelector('span').textContent.replace(' (삭제됨)', '');
        if (confirm(`"${roomNameFromText}" 방을 복구하시겠습니까?`)) {
            socket.emit('restore room', { roomId });
        }
    }
});


chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value) {
        socket.emit('chat message', { 
            message: chatInput.value, 
            roomId: state.currentRoom 
        });
        chatInput.value = '';
    }
});

userList.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('ban-button')) {
        const userIdToBan = e.target.dataset.userId;
        if (confirm(`"${userIdToBan}" 사용자를 이 방에서 차단하시겠습니까?`)) {
            socket.emit('ban user', { userIdToBan: userIdToBan, roomId: state.currentRoom });
        }
    }
});

deleteRoomButton.addEventListener('click', () => {
    if (confirm(`정말로 이 방을 삭제하시겠습니까? 삭제 후 72시간 이내에만 복구 가능합니다.`)) {
        socket.emit('delete room', { roomId: state.currentRoom });
    }
});


// --- Socket Event Handlers ---
socket.on('rooms list', (rooms) => renderRoomList(rooms));

socket.on('join room success', ({ room, history, isOwner }) => {
    state.currentRoom = room.id;
    state.isOwner = isOwner;
    chatRoomName.textContent = room.name;
    // 방장에게만 삭제 버튼 보이기
    if (state.isOwner) {
        deleteRoomButton.style.display = 'inline-block';
    } else {
        deleteRoomButton.style.display = 'none';
    }
    showScreen('chat');
    messages.innerHTML = '';
    history.forEach(addMessage);
});

socket.on('join room failed', ({ message }) => {
    alert(message);
    showScreen('lobby');
    socket.emit('get rooms');
});

socket.on('chat history', (history) => {
    messages.innerHTML = '';
    history.forEach(addMessage);
});

socket.on('chat message', (data) => addMessage(data));

socket.on('room user list update', (users) => renderUserList(users));

socket.on('ban success', ({ message }) => {
    alert(message);
});

socket.on('ban failed', ({ message }) => {
    alert(message);
});

socket.on('banned', ({ roomName, message }) => {
    alert(message);
    state.currentRoom = null;
    state.isOwner = false;
    showScreen('lobby');
    socket.emit('get rooms');
});

socket.on('delete success', ({ message }) => {
    alert(message);
    state.currentRoom = null;
    state.isOwner = false;
    showScreen('lobby');
    socket.emit('get rooms');
});

socket.on('delete failed', ({ message }) => {
    alert(message);
});

socket.on('room deleted', ({ roomName, message }) => {
    alert(message);
    state.currentRoom = null;
    state.isOwner = false;
    showScreen('lobby');
    socket.emit('get rooms');
});

socket.on('restore success', ({ message }) => {
    alert(message);
    showScreen('lobby');
    socket.emit('get rooms');
});

socket.on('restore failed', ({ message }) => {
    alert(message);
});

socket.on('mentioned', ({ message, roomName }) => {
    // 멘션 알림 (예: 브라우저 알림)
    if (document.visibilityState === 'hidden') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(`"${roomName}" 방에서 멘션되었습니다!`, {
                    body: `${message.nickname}: ${message.message}`,
                    // icon: '/icon.png' // 적절한 아이콘 경로, 필요시 추가
                });
            }
        });
    }
    // 추가로 메시지 자체는 addMessage에 의해 렌더링되면서 하이라이트됨
});