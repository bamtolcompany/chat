const fs = require('fs');
const path = require('path');

const ROOMS_FILE = path.join(__dirname, 'rooms.json');

// rooms.json 파일을 읽어 방 데이터를 로드하는 함수
function loadRooms() {
    try {
        if (fs.existsSync(ROOMS_FILE)) {
            const data = fs.readFileSync(ROOMS_FILE, 'utf8');
            return data ? JSON.parse(data) : {};
        }
    } catch (e) {
        console.error("rooms.json 파일을 읽거나 파싱하는 데 실패했습니다:", e);
    }
    return {}; // 파일이 없거나 오류 발생 시 빈 객체 반환
}

// 방 데이터를 rooms.json 파일에 저장하는 함수
function saveRooms(rooms) {
    try {
        fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2)); // null, 2는 가독성을 위해 추가
    } catch (e) {
        console.error("rooms.json 파일에 저장하는 데 실패했습니다:", e);
    }
}

module.exports = {
    loadRooms,
    saveRooms,
};
