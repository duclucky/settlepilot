# Nguồn chính thức và cách tra cứu

Các link dưới đây là nguồn tham khảo. API và account thực phải được kiểm tra lại ở thời điểm tích hợp.

## Cuộc thi và Canteen

- [Tameion Agents Hackathon](https://tameion.thecanteenapp.com/?utm_source=luma): điều kiện, RFB, FAQ, judging và submission.
- [Luma registration](https://luma.com/ivroypr5): lịch và thông tin đăng ký.
- [Canteen Arc node](https://arc-node.thecanteenapp.com/): RPC, CLI và context.
- [Canteen Discord](https://discord.gg/rsVfYutFZg).
- [Arc builder Discord](https://discord.com/invite/buildonarc).

## Arc và Circle

- [Arc docs](https://docs.arc.network/).
- [Circle Agent Stack](https://developers.circle.com/agent-stack).
- [Circle wallets](https://developers.circle.com/wallets).
- [Circle Paymaster](https://developers.circle.com/paymaster).
- [Circle CCTP](https://developers.circle.com/cctp).
- [Circle Gateway](https://developers.circle.com/gateway).
- [Arc App Kit](https://docs.arc.network/app-kit).
- [Arc sample applications](https://docs.arc.network/arc/references/sample-applications).

## Cách ghi nhận nguồn

Ghi URL, ngày truy cập, phiên bản package/CLI và mọi khác biệt giữa docs với runtime vào tài liệu quyết định của sản phẩm đã chọn. Không chép nguyên README hoặc AGENTS của sample vào workspace.

## Agent runtime tham khảo

- [Hermes Agent prompt assembly](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/prompt-assembly.md).
- [Hermes Agent persistent memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md).
- [Hermes Agent skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md).
- [Hermes Agent tools runtime](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/tools-runtime.md).
- [Hermes Agent loop summary](https://github.com/NousResearch/hermes-agent/blob/main/agent/AGENTS.md).

Đối chiếu ngày 2026-09-29. Tameion chỉ học cách lắp context, skills, memory và tool loop; không nhập terminal, browser, messaging, delegation, plugin marketplace hoặc source code Hermes.

## Telegram

- [Telegram Bot API](https://core.telegram.org/bots/api): HTTPS request format and `sendMessage`.
- [Telegram Bot API — receiving updates](https://core.telegram.org/bots/api#getting-updates): `getUpdates` and webhook mechanisms intentionally not implemented.

Đối chiếu ngày 2026-09-29. Tameion chỉ gửi outbound generic alerts; Telegram không phải control plane.
