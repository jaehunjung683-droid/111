# IRON VEIL V2.1

FPS 게임 클라이언트(`게임클라이언트_V2.0.html`)와 **서버 권위형 멀티플레이 서버**입니다.

## 실행

Node.js 20 이상.

```sh
npm install
# (선택) npm run build:client — 서버는 클라이언트 HTML을 직접 찾아 서빙하므로 필수가 아닙니다
npm start              # http://localhost:3000  (게임)  /  /health  /  /metrics
```

브라우저에서 `http://localhost:3000` 을 열면 서버 주소가 자동으로 같은 호스트로 채워집니다.

## 테스트

```sh
npm test            # 전체 (로직·퍼즈·실서버 통합·클라이언트 회귀·정적 빌드)
npm run test:logic  # ws 설치 없이 서버 로직만
```

## 서버 구조 (server/)

| 파일 | 역할 |
| --- | --- |
| `server.js` | HTTP(/health, /metrics, 클라이언트 서빙) + WebSocket 전송 계층, 접속 제한·메시지 속도 제한 |
| `server/game.js` | 방·로비·경기 흐름, 사격/피해/처치/부활, 이동 검증 (전송과 분리되어 단위 테스트 가능) |
| `server/weapons.js` | 무기별 피해·연사·탄약·장전·범위 피해 표 (서버가 신뢰하는 유일한 기준) |
| `server/config.js` | 환경 변수 설정 |

### 권위 모델

- **서버가 결정**: 체력(150), 피해량(무기표), 연사 간격, 탄약/장전, 헤드샷 배율, 처치·점수, 부활/스폰 보호(2.5초), 폭발 범위 피해, 구급상자·포션 회복.
- **클라이언트가 보고**: 위치/시선(20Hz), 발사(`fire`), 명중 주장(`hit`). 서버는 발사 기록·연사 속도·탄약·조준선(과거 450ms 위치 되감기)·사거리로 검증하고, 피해량은 클라이언트 값을 무시합니다.
- **이동 검증**: 비정상 속도의 위치 갱신은 거부하고 `correct`로 되돌립니다. 포탈은 `teleport` 메시지로 허용(생명당 10회). 누적 위반 시 연결을 종료합니다.
- **한계**: 맵 지형이 서버에 없어 *벽 뒤 명중*은 서버가 알 수 없습니다. 완전한 차단은 맵 충돌 데이터를 서버로 옮겨야 합니다.

### 환경 변수

`PORT`, `MAX_PLAYERS`(기본 20), `MATCH_DURATION_SECONDS`(300), `MAX_CONNECTIONS_PER_IP`(30), `MAX_ROOMS`(200),
`ALLOWED_ORIGINS`(쉼표 구분, 비우면 제한 없음), `TRUST_PROXY=0`(프록시 없이 직접 노출할 때만), `LOG_LEVEL=silent`.

## 배포

- **Render**: 저장소를 Blueprint로 연결하면 `render.yaml`로 서비스 1개가 생성됩니다. 무료 플랜은 유휴 시 잠들어 첫 접속이 느릴 수 있습니다.
- **Docker**: `docker build -t iron-veil . && docker run -p 3000:3000 iron-veil`
