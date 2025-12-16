const socket = io();

// DOM Elements
const nicknameContainer = document.getElementById('nickname-container');
const chatContainer = document.getElementById('chat-container');
const nicknameInput = document.getElementById('nickname-input');
const setNicknameButton = document.getElementById('set-nickname-button');
const nicknameError = document.getElementById('nickname-error');

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

// 메시지를 화면에 추가하는 함수
function addMessage(data) {
    const item = document.createElement('li');
    if (data.type === 'system') {
        item.textContent = data.message;
        item.classList.add('system-message');
    } else {
        item.textContent = `${data.nickname}: ${data.message}`;
    }
    messages.appendChild(item);
    window.scrollTo(0, document.body.scrollHeight);
}

// 닉네임 설정 처리
function setNickname() {
    const nickname = nicknameInput.value.trim();
    if (nickname) {
        socket.emit('set nickname', nickname, (response) => {
            if (response.success) {
                localStorage.setItem('nickname', nickname);
                nicknameContainer.style.display = 'none';
                chatContainer.style.display = 'block';
                input.focus();
            } else {
                nicknameError.textContent = response.message;
            }
        });
    }
}

setNicknameButton.addEventListener('click', setNickname);
nicknameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        setNickname();
    }
});

// 페이지 로드 시 localStorage에서 닉네임 불러오기
window.addEventListener('load', () => {
    const savedNickname = localStorage.getItem('nickname');
    if (savedNickname) {
        nicknameInput.value = savedNickname;
    }
    nicknameInput.focus();
});

// 메시지 전송 처리
form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value) {
        socket.emit('chat message', input.value);
        input.value = '';
    }
});

// 채팅 기록 수신 처리
socket.on('chat history', (history) => {
    messages.innerHTML = ''; // 기존 메시지 삭제
    history.forEach(addMessage);
});

// 실시간 메시지 수신 처리
socket.on('chat message', (data) => {
    addMessage(data);
});
