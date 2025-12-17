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
const emojiButton = document.getElementById('emoji-button');
const emojiPicker = document.getElementById('emoji-picker');

// --- State ---
const state = {
    chatMode: null,
    nickname: null,
    userId: null,
    currentRoom: null,
    isOwner: false,
    pendingReconnect: false, // New state for reconnection management
    pendingAction: null, // New: To store pending actions for when socket connects
};

let hasConnectedOnce = false; // New flag to track initial connection

// --- Emojis ---
const commonEmojis = [
    '😀', '😂', '👍', '🙏', '❤️', '🤩', '🤔', '🥳', '😎', '😭',
    '😍', '😜', '😇', '🤫', '💯', '🔥', '✨', '🎉', '🎁', '👋',
    '🚀', '💻', '💡', '⏰', '💬', '🐶', '🐱', '👍🏻', '👎🏻', '👌🏻'
];

// --- Functions ---
function generateUUIDv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getOrSetUserId() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = generateUUIDv4();
        localStorage.setItem('userId', userId);
    }
    state.userId = userId;
    return userId;
}

function updateUrl(path, replace = false) {
    if (replace) {
        history.replaceState(null, '', path);
    } else {
        history.pushState(null, '', path);
    }
}

function showScreen(screenName, path = '') {
    Object.values(screens).forEach(screen => screen.style.display = 'none');
    screens[screenName].style.display = 'block';
    if (screenName === 'chat') {
        screens.chat.style.display = 'flex';
    }
    if (path) {
        // Replace current state if it's the initial load or a mode change
        // Push a new state for navigation within a mode (e.g., entering a room)
        const replaceState = (history.state === null && location.pathname === '/') || (screenName === 'modeSelection' || screenName === 'nickname' || screenName === 'lobby');
        updateUrl(path, replaceState);
    }
}

function router() {
    const path = location.pathname;
    console.log('Routing to:', path); // For debugging

    state.pendingAction = null; // Reset pending action on each route

    if (path === '/') {
        showScreen('modeSelection', '/');
    } else if (path === '/nickname') {
        showScreen('nickname', '/nickname');
    } else if (path === '/lobby') {
        showScreen('lobby', '/lobby');
        // Only emit 'get rooms' if socket is connected
        if (socket.connected) {
            socket.emit('get rooms');
        } else {
            // If not connected, it will be handled by socket.on('connect')
            // when it eventually connects and calls router() again.
            // Or if pendingReconnect is true, reconnectToChat will handle it.
        }
    } else if (path.startsWith('/chat/local/')) {
        state.chatMode = 'local';
        const nickname = path.split('/')[3]; // /chat/local/NICKNAME
        if (nickname) {
            state.nickname = decodeURIComponent(nickname);
            showScreen('chat', path);
            state.pendingAction = 'joinChat'; // Signal pending action
        } else {
            // Invalid local chat URL, redirect to nickname selection
            showScreen('nickname', '/nickname');
        }
    } else if (path.startsWith('/chat/open/')) {
        state.chatMode = 'open';
        const parts = path.split('/'); // /chat/open/ROOM_ID/NICKNAME
        const roomId = parts[3];
        const nickname = parts[4];

        if (roomId && nickname) {
            state.currentRoom = roomId;
            state.nickname = decodeURIComponent(nickname);
            showScreen('chat', path);
            // Ensure userId is set before emitting
            if (!state.userId) getOrSetUserId(); // Ensure userId is set before it's used
            state.pendingAction = 'joinChat'; // Signal pending action
        } else {
            // Invalid open chat URL, redirect to lobby
            showScreen('lobby', '/lobby');
        }
    } else {
        // Fallback for unknown paths
        showScreen('modeSelection', '/');
    }
}

function addMessage(data) {
    const item = document.createElement('li');
    let messageText = data.message;

    // 멘션된 메시지 하이라이트
    if (data.mentions && data.mentions.includes(state.userId)) {
        item.classList.add('mentioned-message');
    }
    
    // 메시지 내 이모지 텍스트를 실제 이모지로 변환 (선택 사항, 브라우저가 직접 렌더링하므로 필요 없을 수 있음)
    // messageText = messageText.replace(/:\)/g, '😀').replace(/:D/g, '😂'); 

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
            if (room.isOwner) { // 방장에게만 자신의 삭제된 방 표시 및 복구 버튼
                hasDeletedRooms = true;
                li.innerHTML = `<span>${room.name} (삭제됨)</span>`;
                const restoreButton = document.createElement('button');
                restoreButton.textContent = '복구';
                restoreButton.className = 'restore-button';
                li.appendChild(restoreButton);
                deletedRoomList.appendChild(li);
            }
        } else {
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
                showScreen('lobby', '/lobby');
                socket.emit('get rooms');
            } else { // Local chat
                showScreen('chat', `/chat/local/${encodeURIComponent(nickname)}`);
            }
        } else {
            nicknameError.textContent = response.message;
        }
    });
}

function selectMode(mode) {
    state.chatMode = mode;
    showScreen('nickname', '/nickname');
    const savedNickname = localStorage.getItem('nickname');
    if (savedNickname) nicknameInput.value = savedNickname;
    nicknameInput.focus();
}

// --- Event Listeners ---
window.addEventListener('load', () => {
    getOrSetUserId();
    router(); // Call router on initial load to ensure UI is displayed promptly

    // 이모지 패널 채우기
    commonEmojis.forEach(emoji => {
        const button = document.createElement('button');
        button.textContent = emoji;
        emojiPicker.appendChild(button);
    });
});

window.addEventListener('popstate', router); // Handle back/forward buttons

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

emojiButton.addEventListener('click', () => {
    emojiPicker.style.display = emojiPicker.style.display === 'grid' ? 'none' : 'grid';
});

emojiPicker.addEventListener('click', (e) => {
    if (e.target && e.target.tagName === 'BUTTON') {
        chatInput.value += e.target.textContent;
        chatInput.focus();
        emojiPicker.style.display = 'none';
    }
});

// --- Socket Event Handlers ---

// Placeholder for reconnectToChat function (to be fully implemented later)
function reconnectToChat() {
    console.log('Attempting to handle pending chat actions...');
    if (state.pendingAction === 'joinChat' && state.nickname && state.chatMode) {
        socket.emit('set nickname', {
            nickname: state.nickname,
            mode: state.chatMode,
            userId: state.userId
        }, (response) => {
            if (response.success) {
                if (state.chatMode === 'open' && state.currentRoom) {
                    socket.emit('join room', { roomId: state.currentRoom });
                } else if (state.chatMode === 'local') {
                    // For local chat, just showing the chat screen is enough after setting nickname
                    showScreen('chat', `/chat/local/${encodeURIComponent(state.nickname)}`);
                }
                // Clear pending action after successful processing
                state.pendingAction = null;
            } else {
                console.error("Pending action failed (set nickname):", response.message);
                alert(`채팅 재연결 실패: ${response.message}. 로비로 돌아갑니다.`);
                showScreen('lobby', '/lobby');
                socket.emit('get rooms');
                state.pendingAction = null; // Clear pending action on failure
            }
        });
    } else if (location.pathname === '/lobby') { // If path is lobby, and no pendingAction, just get rooms
        socket.emit('get rooms');
    }
    state.pendingReconnect = false; // Always clear pending reconnect after trying
}

socket.on('connect', () => {
    console.log('Socket connected. hasConnectedOnce:', hasConnectedOnce, 'pendingReconnect:', state.pendingReconnect);
    
    // router() is now called by window.addEventListener('load') and popstate.
    // So, no need to call router() here. It ensures state is set from URL.

    if (state.pendingReconnect || state.pendingAction) {
        // If there's a pending reconnect (real disconnect/reconnect)
        // or a pending action from router (initial load to chat URL, popstate), handle it.
        console.log('Handling pending reconnect or action...');
        reconnectToChat();
    } else if (location.pathname === '/lobby') {
        // If it's a fresh load to lobby and no pending actions/reconnect, just get rooms
        socket.emit('get rooms');
    }
});

socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    // If the user was in a chat room, set pendingReconnect to true
    if ((state.chatMode === 'local' || state.chatMode === 'open') && state.nickname) {
        state.pendingReconnect = true;
        console.log('Set pendingReconnect to true for:', state.nickname, 'in', state.chatMode);
        // Optionally show a "connecting..." message to the user
        // For now, we'll let the UI remain as is, and reconnect will update it.
    }
    // Optionally alert the user about disconnection if they were actively chatting
    if (state.currentRoom || state.chatMode === 'local') {
        // alert('서버와의 연결이 끊어졌습니다. 재연결을 시도합니다...');
    }
});

socket.on('rooms list', (rooms) => renderRoomList(rooms));

socket.on('join room success', ({ room, history, isOwner }) => {
    state.currentRoom = room.id;
    state.isOwner = isOwner;
    chatRoomName.textContent = room.name;
    if (state.isOwner) {
        deleteRoomButton.style.display = 'inline-block';
    } else {
        deleteRoomButton.style.display = 'none';
    }
    showScreen('chat', `/chat/open/${room.id}/${encodeURIComponent(state.nickname)}`);
    messages.innerHTML = '';
    history.forEach(addMessage);
});

socket.on('join room failed', ({ message }) => {
    alert(message);
    showScreen('lobby', '/lobby');
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
    showScreen('lobby', '/lobby');
    socket.emit('get rooms');
});

socket.on('delete success', ({ message }) => {
    alert(message);
    state.currentRoom = null;
    state.isOwner = false;
    showScreen('lobby', '/lobby');
    socket.emit('get rooms');
});

socket.on('delete failed', ({ message }) => {
    alert(message);
});

socket.on('room deleted', ({ roomName, message }) => {
    alert(message);
    state.currentRoom = null;
    state.isOwner = false;
    showScreen('lobby', '/lobby');
    socket.emit('get rooms');
});

socket.on('restore success', ({ message }) => {
    alert(message);
    showScreen('lobby', '/lobby');
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