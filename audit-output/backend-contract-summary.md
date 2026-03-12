# Contrato backend observado (DIXIT/server.js)

## REST
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/profile`
- `PUT /api/profile`
- `GET /api/rooms`
- `GET /api/rooms/:code/history`

## WebSocket path
- `GET /ws` (upgrade)

## Mensajes cliente -> servidor
- `join`
- `start_solo`
- `end_room`
- `set_ready`
- `set_timer`
- `set_point_limit`
- `set_mode`
- `start`
- `add_bot`
- `start_with_bots`
- `submit_clue`
- `submit_card`
- `vote`
- `next_round`
- `continue`
- `leave`

## Mensajes servidor -> cliente
- `joined`
- `state`
- `error`
- `ended`
