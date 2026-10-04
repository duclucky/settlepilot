# Telegram notifications — outbound only

Ngày: 2026-09-29. Trạng thái: user đã chọn và cho phép triển khai.

## Mục tiêu

Tameion gửi mọi notification cần người dùng biết sang Telegram để họ không phải ngồi trước PC. Telegram chỉ là kênh cảnh báo một chiều. Bot không đọc tin nhắn, không nhận lệnh, không có webhook/getUpdates và không có button thực thi. Mọi review, approval, thay đổi policy, recovery và giao dịch vẫn chỉ thực hiện trong ứng dụng localhost trên PC.

## Quy tắc riêng tư

Telegram chỉ nhận template tổng quát gồm tên sản phẩm, cấp độ, loại trạng thái và lời nhắc mở localhost. Không gửi contractor, invoice, obligation ID, amount, wallet, chain source, transaction hash, policy reason, evidence, câu hỏi của Agent, câu trả lời owner hoặc URL có token.

Ví dụ hợp lệ:

- `NORMAL · A payment completed successfully. Open Tameion on your PC to review.`
- `MEDIUM · The Agent needs your decision. Open Tameion on your PC.`
- `HIGH · An unresolved local action is approaching its deadline. Open Tameion on your PC now.`

## Phân cấp và nhắc lại

| Cấp | Trường hợp | Nhắc lại |
|---|---|---|
| `NORMAL` | incoming payment verified, CCTP mint verified, contractor payment settled | Gửi một lần |
| `MEDIUM` | owner/evidence decision đang mở và deadline còn trên 24 giờ | Mỗi 6 giờ khi chưa giải quyết |
| `HIGH` | owner/evidence decision còn không quá 24 giờ hoặc đã quá hạn; execution/bridge outcome chưa rõ; fallback escalation | Mỗi 30 phút khi chưa giải quyết |

Khi notification chuyển từ `MEDIUM` sang `HIGH`, gửi ngay mà không chờ hết interval cũ. Khi local action được giải quyết, dừng reminder. Dispatcher lưu fingerprint, cấp độ, số lần gửi, lần gửi cuối và lần thử tiếp theo trong SQLite; không lưu nội dung Telegram hoặc secret.

## Delivery

- Dùng HTTPS `sendMessage` của Telegram Bot API với JSON body; không dùng reply markup, callback hoặc link điều khiển.
- Trang Settings trên localhost ghi `TELEGRAM_NOTIFICATIONS_ENABLED`, `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` vào `.env` bị ignore bằng thay thế file atomic; các biến khác được giữ nguyên.
- Token chỉ đi từ form localhost vào backend khi người dùng thay đổi nó. API không bao giờ trả token đã lưu về browser hoặc ghi token/provider response vào log. Chat ID không phải credential và được trả về để người dùng kiểm tra đích nhận.
- Mặc định tắt. Thiếu hoặc sai config thì không gửi; app vẫn vận hành local và ghi delivery failure an toàn để retry theo backoff.
- Không gọi `getUpdates`, `setWebhook` hoặc tạo inbound route.

## Tiêu chí nghiệm thu

- Collector tạo notification đúng từ durable state và không tạo trùng sau restart.
- Message template không chứa bất kỳ dữ liệu nghiệp vụ nào.
- `NORMAL` gửi một lần; `MEDIUM`/`HIGH` nhắc đúng interval và dừng khi local action resolved.
- Escalation deadline làm mức đổi từ medium sang high và gửi ngay.
- Telegram failure không ảnh hưởng planning/payment và không làm lộ token hoặc provider response body.
- Local settings chịu session/origin/loopback guard, áp dụng không cần restart và giữ nguyên mọi biến `.env` ngoài ba biến Telegram.
- Tests dùng transport giả; không gửi Telegram thật, không gọi model/RPC và không phát giao dịch.

## Nguồn

- Telegram Bot API `sendMessage`: https://core.telegram.org/bots/api#sendmessage
- Telegram Bot API inbound mechanisms (`getUpdates`, webhooks): https://core.telegram.org/bots/api#getting-updates

Đối chiếu ngày 2026-09-29.
