# Công cụ và cài đặt tham khảo

Workspace đã có runtime TypeScript/React, Express, SQLite tích hợp Node và adapter Circle/Arc. Dùng Node >=24.11, manifest và lockfile trong workspace; xem README để chạy. Các CLI bên dưới là tham khảo, không phải dependency bắt buộc của app hiện hành.

## Công cụ chính thức

```powershell
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
npm install -g @circle-fin/cli
```

Circle CLI yêu cầu Node.js tương thích theo [tài liệu chính thức](https://developers.circle.com/agent-stack/circle-cli). ARC CLI cung cấp context, docs và RPC testnet do Canteen hướng dẫn.

## Quy tắc cài đặt

- Dùng manifest và lockfile riêng của sản phẩm; không import xuyên từ workspace tooling.
- Đọc `--help` và version thực tế trước khi dùng CLI.
- Không chấp nhận Terms, login, tạo wallet, nạp tiền hoặc gửi giao dịch chỉ vì đã cài tool.
- Secret chỉ ở secret manager hoặc file local bị ignore; không đưa vào log hay commit.
- Cấu hình model, Circle Agent Wallet và nguồn nghiệp vụ tại **Setup** trên localhost. Telegram ở **Setup → Optional Telegram notifications**. Secret lưu trong `.env` bị ignore; app không đọc Telegram message hoặc nhận command.
- Cấu hình primary LLM và Jev tại **Authority & connections → LLM connection**. Mỗi provider có endpoint, model và API key write-only; remote endpoint phải dùng HTTPS, HTTP chỉ dùng được trên loopback. Lưu cấu hình không tự gọi provider.
- Trước adapter mới: đọc docs chính thức, đối chiếu types, viết contract test, rồi mới thử Arc Testnet trong quyền được cấp.

## Arc Testnet

- Network: `ARC-TESTNET`.
- Chain ID: `5042002`.
- Chỉ dùng testnet trong development và demo khi chưa có quyền mainnet riêng.
- Không dán private key, recovery secret hoặc RPC URL có token vào transcript.
