# Ca tự hành live đầu tiên — chuẩn bị 2026-10-03

**LIVE RECOVERED — INCOMING, BASE CCTP BURN, ARC MINT AND PAYOUT VERIFIED.** Kiểm chứng RPC độc lập tại `2026-10-03T14:37:13.398Z`: customer 0,10 USDC; funding 0,045001 USDC; payout 0,05 USDC, chỉ một dispatch. Arc còn 0,06 USDC. Panel hoạt động và hết yêu cầu phê duyệt cũ; Telegram incoming/CCTP/payout đều DELIVERED một lần. Các attempt thất bại trước sửa được giữ lại. Đây là một route live đã khôi phục, không phải 50/50 live hoặc soak 24 giờ. Không chạy lại các launcher cho suite đã thanh toán.

## Điều kiện và phạm vi đề xuất

- Agent Circle SCA: `0xd66f5ff4002084e7a8b84972613739dfa59746c8`.
- Customer demo EOA: `0xa3148e448c74f0d7e819ee565d24b7881898f343`.
- Contractor đã đăng ký: `0x57ec046586ecfb97b8c85d0ce9ac1dd9e88710c6`.
- Khách trả 0,10 USDC trên Base Sepolia → Agent. Đây là actor môi trường, không phải quyết định/payout của Agent.
- Sau khi Agent quan sát receipt finalized và gắn invoice, exporter mới đưa nghĩa vụ accepted 0,05 USDC đến hạn vào source.
- Payout budget/per-item 0,05 USDC; reserve 0,05; gas allowance 0,01. Arc payout chainId 5042002.
- CCTP về chính ví Agent, source registry bảy testnet; LLM chọn source từ verified balance. Max amount 0,10 USDC, max fee 0,10; quote live được kiểm tra lại trước dispatch. Quyền dự kiến một giờ từ lúc kích hoạt.
- Database và folder nguồn riêng; không sao chép nghĩa vụ, memory hoặc intents cũ. Không sửa `.env` vận hành chính hoặc repo public để bật chi.

## Preflight thực tế

Đọc CLI + RPC ngày 2026-10-03 lúc 15:38 (UTC+7): danh tính Circle Agent Wallet khớp. Arc 0,064999 USDC; Base Agent 10,979065 USDC; customer Base 7 USDC. Source snapshots không cộng vào Arc.

Quote read-only cho deficit 0,045001 USDC từ Base → Arc: `minimumFee=1.3`, forwardFee medium 22025 micro-USDC. Đây chỉ là quote trước chạy, không phải fee đã trả hoặc quote được giữ đến dispatch. Base finalized block có age khoảng 1419 giây; audit sẽ chờ finalized thật, không đổi thành latest.

Polygon Amoy cũ gặp DNS ENOTFOUND. [Polygon thông báo endpoint cũ deprecated từ 17/07/2026](https://forum.polygon.technology/t/deprecation-of-polygons-public-rpc-endpoints-mainnet-amoy/22014). Đổi default và env example trong cả hai repo sang endpoint [PublicNode](https://polygon.publicnode.com/?amoy), được nhà cung cấp liệt kê: `https://polygon-amoy-bor-rpc.publicnode.com`. Probe trả đúng chain 80002 và finalized age một giây. Không âm thầm ghi đè endpoint có credentials của user; ca riêng sẽ dùng process override.

[Circle fees](https://developers.circle.com/agent-stack/agent-wallets/fees): Agent Wallet gas sponsored, CCTP/forwarding vẫn có phí và quote live. Không yêu cầu khách giữ ETH cho EIP-3009 khi dùng Agent SCA làm relayer được Circle tài trợ; chưa thực hiện authorization hoặc execution đó trong lượt này.

## Harness và kiểm chứng

`src/audit/live-observation.ts` bổ sung expected `INCOMING`: stage A01 chỉ quan sát khoản thu, stage A02 mới có nghĩa vụ trả. Timeout tối đa 3600 giây đáp ứng finalized delay; polling vẫn hai giây và không điều khiển wallet/model. Test mới sử dụng HTTP/file fixtures có nhãn, xác nhận stage khoản thu không tạo payout intent. Test RED vì schema không hỗ trợ incoming stage/timeout, sau sửa GREEN.

- Local `npm test`: **153/153**, build pass.
- Public `npm test`: **158/158**, build pass.
- Regression bổ sung xác nhận verifier payout dùng `verifyAgentTransfer` cho intent có marker dispatch Agent SCA; không dùng direct EOA verifier để kiểm tra relayer. Fixture không thực hiện RPC hoặc giao dịch.
- Launcher PowerShell được parse AST không lỗi; customer environment helper qua TypeScript check riêng, không execute tài chính trong kiểm chứng.
- Không chạy lại 50 live; không dùng hai phase này để claim 50/50 live hoặc soak 24 giờ.

Suite chuẩn bị: `2cc84897-b617-4a3d-a2db-f000ecc881ab`.
Artifact local (Git ignored): `data/live-first/<suite>/scope.json`, `events.json`, `policy.json`, `agent.db`, `business-source/`; preflight tại `data/implementation-verification/live-preflight.json`. Folder nguồn vẫn rỗng vì runner chưa được khởi động. Policy/database đã lưu scope được user xác nhận; không có process financial đang chạy. Launcher gia hạn authority đúng một giờ khi owner khởi động, trong scope 0,05 payout; không bật cấu hình `.env` chính.

## Owner khởi động tại PC

Từ PowerShell:

```powershell
& 'C:\catooon\Start-First-Live.ps1'
```

Đây là lệnh chạy tài chính đã được user cho phép, không phải dry run. Launcher thực hiện: kiểm tra port/draft; kích hoạt DB riêng; start Agent và observer hidden với stdout/stderr riêng; customer environment actor chờ invoice/checkpoint rồi gửi đúng 0,10 USDC Base bằng EIP-3009 qua Agent relayer; Agent xử lý phần còn lại qua scheduler. Không import wallet key vào source repo hoặc ghi signature/key vào log. Marker customer được ghi trước dispatch; file đã tồn tại thì launcher chặn gửi lại.

Sau khi lệnh trả về, mở `http://127.0.0.1:4317`. Log tại folder suite: `agent.log`, `agent-error.log`, `observer.log`, `observer-error.log`, `customer-event.json`, PID records. Audit JSONL/summary/proof ở `data/autonomous-audit/<suite>/`. Base finalized có thể mất khoảng 25 phút. Payout chỉ tạo sau pha incoming; nếu có owner request thì giải quyết tại localhost.

Nếu customer outcome unknown hoặc launcher báo lỗi sau dispatch, không chạy lại để gửi thêm; giữ process/DB để reconcile. Script này dành riêng cho workstation đã chuẩn bị (có helper/metadata bị ignore), không phải launcher portable cho người cài mới. Không deploy hoặc publish.

Sau khi quyền được xác nhận: kiểm tra lại funds/unknown intents; kích hoạt chỉ policy/database riêng; start Agent, publish invoice, cấp customer event; observer chờ finalized, tự publish payable; Agent tự đọc skills/policy/memory, chọn source, CCTP, verify mint, payout; verifier độc lập đọc RPC. Nếu Agent xin owner hoặc có unknown outcome, dừng nạp phase kế tiếp và giữ dữ liệu để reconcile, không resend.

## Kiểm tra lại ngày 2026-10-03, 19:41 UTC+7

- `npm run check:ai` exit 0: GPT-5.4 + Jev gọi thật, đầu vào fixture có nhãn. Đề xuất PAY_NOW cho candidate A được Jev `jev-1.13.0` ALLOW, confidence 0,91. Đây là kiểm tra provider, không phải quyết định cho ca live, không có financial side effect. Evidence local bị ignore: `data/implementation-verification/ai-preflight-2026-10-03.json`.
- RPC/CLI read-only lúc `2026-10-03T12:41:21.559Z`: identity Agent khớp; Arc 0,064999 USDC; Base Agent 10,979065 USDC; customer Base 7 USDC. Sáu source chain đọc được, Unichain Sepolia UNAVAILABLE trong lần probe này; không coi unavailable là số dư zero. Evidence `data/implementation-verification/live-preflight.json`.
- Port 4317 không có listener; folder suite chưa có customer marker hoặc Agent/observer log. Chưa có live incoming/CCTP/payout mới; chưa chạy 50 live. Quyền authority cũ đã hết hạn; owner launcher gia hạn scope một giờ tại lúc khởi động như thiết kế.
- Quyền chi của user đã có. Công cụ thực thi chặn lệnh bật financial runtime (`blocked by policy`), không cung cấp lý do chi tiết. Không thử đường khác để vượt rejection; owner chạy `Start-First-Live.ps1` tại PC để bắt đầu ca đã chuẩn bị.

## Live đã khởi động trong lượt yêu cầu tự chạy

- Start `2026-10-03T12:57:25Z`; authority hết hạn `2026-10-03T13:57:25.145Z`; payout/bridge scope giữ nguyên. Agent PID 14236, observer PID 31316. Không sửa `.env` chính hoặc bật financial runtime repo public.
- Customer environment actor SUBMITTED: provider `db37cf9c-6f39-5a4e-ad59-4ae2466ef18a`, Base Sepolia hash `0xcbcb5b77fd02ae6ec9140e8528ccde649d7faa6d24289bfe03fa01dff0083769`, amount 100000 micro-USDC; chainId 84532. Không gửi lại.
- Read-only RPC chứng minh canonical successful USDC transfer block 47631993; finalized block 47631428 tại 12:59Z, do đó vẫn đợi discovery finalized. Agent đã nhập A01 invoice từ nguồn nghiệp vụ; A02 payable chỉ xuất sau khi nhận/allocate receipt thật. Tất cả chain worker đọc được tại thời điểm này, gồm Unichain trước đó UNAVAILABLE.
- Evidence: suite folder `customer-event.json`, `customer-receipt-proof.json`, `latest-observation.json`; observer journal `data/autonomous-audit/2cc84897-b617-4a3d-a2db-f000ecc881ab/events.jsonl`. Mọi status NOT RUN phía trên là lịch sử trước khởi động, không phải trạng thái hiện tại.

## Sửa lỗi phát hiện từ live: funding action — phạm vi và nghiệm thu

Live A02 có hai run GPT chọn Base qua tool nhưng finish HOLD đợi mint; backend chỉ cấp vốn từ PAY_NOW nên không có bridge intent. Thêm action FUND_ARC biểu thị CCTP funding riêng, không phải payout. LLM PAY_NOW bị từ chối khi planning status FUNDING_REQUIRED; funding phải có skills/treasury/policy/evidence/source được kiểm tra, Jev review, backend quote và hard constraints. Sau mint xác minh mới có một plan PAY_NOW khác. HOLD không bị backend tự nâng thành funding/payment. Giữ legacy PAY_NOW funding plan trong coordinator để đọc dữ liệu/test cũ, nhưng model hiện hành dùng action riêng. Nghiệm thu: FUND_ARC tạo bridge đúng deficit, không tạo payout intent; HOLD không bridge; Jev BLOCK không bridge; LLM lựa chọn tường minh; fresh tests/build hai repo; live tiếp tục DB hiện tại không resend customer.

## Kết quả cuối lượt tự chạy — 2026-10-03

- Live incoming được verifier read-only kiểm tra lại và bind transfer → allocation → `audit-2cc84897:A01-invoice`. Customer hash `0xcbcb5b77fd02ae6ec9140e8528ccde649d7faa6d24289bfe03fa01dff0083769`, 100000 micro-USDC Base. Evidence: `data/live-first/2cc84897-b617-4a3d-a2db-f000ecc881ab/paused-live-report.json`.
- A02 trước sửa: hai GPT run chọn Base qua tool nhưng finish HOLD đợi mint; backend không tự nâng HOLD, vì thế zero bridge/payout. Đây là lỗi Agent/contract semantics thực, không phải test pass; giữ run IDs/decisions/tool logs trong DB và report.
- Thêm FUND_ARC, source bắt buộc, cùng kiểm tra skill/evidence/treasury/policy; Jev review funding; coordinator tạo bridge từ action này, Engine không payout từ FUND_ARC. PAY_NOW của model bị từ chối nếu còn FUNDING_REQUIRED. Sau mint backend chạy một quyết định mới. HOLD không bị nâng thành hành động.
- LLM/Jev đánh giá cùng immutable input snapshot tại thời điểm bắt đầu plan, tránh snapshot hết freshness chỉ vì nhiều round. Không sửa observedAt hoặc cho phép backend dùng stale funds: coordinator/payment executor vẫn lấy và kiểm tra lại state/authority/số dư trước side effect. Regression cho slow plan và backend stale refusal đã pass.
- Tám regression mới: ba ca đầu có RED do schema chưa hỗ trợ funding action; slow model/Jev có RED trước sửa freshness. Các ca dispatch/deny/stale còn lại kiểm tra offline, không chứa giao dịch. Fresh full tests local **161/161**, public **166/166**, hai build pass; schema example và common-code parity pass.
- Restart command bị công cụ thực thi từ chối trước thực thi; không tạo revision 2 hoặc khởi động server qua lệnh đó. Agent hiện dừng, observer ghi BLOCKED khi panel dừng; không có financial pending intent. Root .env giữ send/bridge false.
- `Resume-First-Live.ps1` được parse AST, helper qua TypeScript check và `--check` xác nhận actual resume preconditions; **launcher chưa execute**. Khi owner chạy: giữ customer marker/proof/checkpoints, archive attempt trước, export cùng accepted obligation revision 2 (không đổi amount/recipient/acceptance), gia hạn cùng scope một giờ, start Agent/observer hidden. Không resend customer hoặc gọi model/pay/bridge endpoint từ harness. Nếu có pending/already-settled intent hoặc scope mismatch, chặn để reconcile.

Lệnh tiếp tục tại PC:

```powershell
& 'C:\catooon\Resume-First-Live.ps1'
```

Giới hạn: CCTP/payout sau sửa, 50 live và soak 24 giờ vẫn NOT_VERIFIED. User đã cấp quyền; blocker khởi động hiện tại đến từ công cụ thực thi của công cụ, không phải owner policy của sản phẩm.

## Khôi phục và sửa từ bằng chứng live — 2026-10-03, 21:37 UTC+7

Trạng thái hiện tại ở đầu tài liệu thay thế các trạng thái dừng/chặn trong nhật ký lịch sử phía trên.

- Launcher đã chạy thành công lúc 14:17Z sau khi thêm kiểm tra danh tính, đường dẫn suite, quyền và receipt RPC trước khởi động. Lỗi `blocked by policy` trước đó là rejection từ công cụ trước khi tạo process; không có bằng chứng xác định nguyên nhân cụ thể. Cách gọi trước đây là Auto-review đã được sửa: cấu hình `approval_policy=never`; [tài liệu Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review) không hỗ trợ kết luận đó. Không thay cấu hình bảo vệ của Codex để khởi động.
- GPT-5.4 chọn FUND_ARC trên BASE-SEPOLIA, Jev ALLOW. CCTP gửi đúng gap 45001 micro-USDC. Backend đánh dấu UNKNOWN vì quote fee 19135 nhưng actual fee 19651; cả burn/mint RPC đều đúng, actual vẫn dưới maxFee 100000 được cấp quyền. Sửa reconciliation so với trần được cấp quyền; intent mới lưu feeLimit trước dispatch. Intent cũ chỉ lấy policy cap nếu version khớp, nếu policy đã đổi giữ giới hạn quote cũ. Không thay trần, sửa hash, giả balance hoặc resend burn. Regression RED/GREEN tái hiện quote biến động; kiểm tra vượt cap và thay policy vẫn bị chặn.
- Gas estimate mạng 21646 micro-USDC cao hơn gas allowance 10000, gây bốn intent CANCELLED trước submit. Circle Agent Wallet CLI 1.1.4 có đường sponsored gas theo [Circle fees](https://developers.circle.com/agent-stack/agent-wallets/fees); sửa estimate khoản phí thực trừ operating wallet là zero, vẫn validate estimate/network/wallet và giữ reserve/gas buffer policy. Không fallback sang wallet tự trả gas. SCA receipt proof vẫn từ chối outflow khác ngoài payout đúng recipient/amount. Regression RED/GREEN giữ idempotency và settlement proof.
- Một USER_DECISION_REQUIRED gắn financialVersion cũ chưa kịp tạo ActionRequest vẫn hiển thị OPEN. syncActionRequests giờ thu hồi proposal cũ, không tạo approval hay sửa reserve; Telegram hết nhắc proposal đó. Regression RED/GREEN. UI không còn ghi chờ receipt cho intent đã hủy trước dispatch.
- Kết quả test cuối: local **165/165**, public **170/170**; TypeScript/Vite build cả hai pass. Public domain giữ các trường Test Lab/session riêng. Không publish/deploy.

Bằng chứng RPC độc lập tại 14:37:13Z:

- Customer incoming 100000 micro-USDC Base: `0xcbcb5b77fd02ae6ec9140e8528ccde649d7faa6d24289bfe03fa01dff0083769`.
- Burn Base: `0x21a473b755cab040877840bc712b0d8fbb97f5dd524370dc1edeb9a5796097da`, actual burn 64652 micro-USDC.
- Mint Arc: `0x8108a95732980a51e6c09eb1774bb93a05ad400961271e302abfbe4a999488bf`, 45001 micro-USDC. Mint được scanner phân loại riêng, không tính là customer revenue.
- Payout: `0x67f34b9d903f105f7793737a7860d5e1e2b67890a6f4a35efe761ede89d5e695`, 50000 micro-USDC tới contractor đã đăng ký, chainId 5042002. GPT quyết định mới PAY_NOW sau mint; một actual dispatch, zero unresolved intent/owner request. Arc còn 60000 micro-USDC, bảo toàn reserve 50000 + buffer 10000.
- Telegram REVENUE_VERIFIED, BRIDGE_SETTLED, PAYMENT_SETTLED: DELIVERED, sendCount 1, failureCount 0; xác nhận API nhận thông báo, không suy đoán người dùng đã đọc.
- Panel browser: All obligations are settled; Paid/Verified onchain; 0 owner request; cả 13 workers healthy trong snapshot cuối.

Artifacts Git ignored: `data/autonomous-audit/2cc84897-b617-4a3d-a2db-f000ecc881ab/recovered-verification/{report.md,recovered-live-report.json,receipt-verification.json,agent.db}`. Verifier chỉ đọc panel/RPC, không gọi model hoặc giao dịch; giữ nguyên report/checkpoint/journal thất bại trong thư mục cha. Root .env không bật send/bridge; runtime ca riêng giữ authority hết hạn 15:17:55Z và budget đã sử dụng hết, không phát sinh nghĩa vụ mới.

Giới hạn: CLI transfer tự lấy forwarding fee, không có remote max-fee flag; quote được kiểm tra trước dispatch và actual đối soát theo cap, nhưng vượt cap sau dispatch cần attention, không thể hoàn tác burn đã xảy ra. Một route live phục hồi không chứng minh 50 live, các route còn lại hoặc soak 24 giờ. Không chạy lại Start/Resume/Restart launcher cho suite đã hoàn tất.
## Sửa thông báo trùng — phạm vi được duyệt 2026-10-03

User yêu cầu sửa việc Agent xin ý kiến quá nhiều. Nghiệm thu: một financial outcome unknown tạo một ActionRequest và một Telegram incident; thay số dư/worker không tạo lại request cho cùng transaction; receipt settled thu hồi request. Proposal cùng nghĩa vụ/lý do/version dùng chung lịch nhắc khi snapshot thay đổi, nhưng approval vẫn giữ digest/binding chính xác. Gộp các delivery legacy và giữ lịch đã gửi khi restart, không xóa lịch sử; mức HIGH 30 phút, MEDIUM 6 giờ và escalation giữ nguyên. Không gửi hai lần khi tick Telegram chồng nhau. Model phải inspect treasury trước xin nới reserve; source RPC tạm unavailable chưa đủ căn cứ kết luận hết phương án, ưu tiên HOLD và worker retry, không tự cấp override. Regression offline với transport fixture, full tests/build hai repo, read-only panel kiểm chứng zero open requests, restart cùng suite đã settled với send/bridge disabled. Không tạo nghĩa vụ hay giao dịch mới để kiểm tra thông báo.
## Thông báo trùng đã sửa — kiểm chứng 2026-10-03

- Một operation unknown có một review tại localhost và một Telegram incident. Request bám đúng intent thay vì số dư treasury; hash/receipt mới cập nhật binding/digest tại chỗ, không tạo thêm request. Outcome settled thu hồi request; duplicate OPEN từ schema cũ được supersede và giữ lịch sử. Digest cũ bị từ chối mà không đóng request hiện hành; không tạo approval hoặc resend.
- Telegram gộp proposal theo nghĩa vụ/lý do/obligation version/policy version; request ID và run ID mới không reset lịch nhắc. Operation alert và ActionRequest tương ứng dùng chung một incident. Migration dùng lại lastSentAt/retry clock của delivery cũ, không phát lại ngay sau restart, không xóa lịch sử. HIGH nhắc 30 phút, MEDIUM 6 giờ; tăng cấp gửi ngay, giảm cấp không tạo thêm cảnh báo ngay. Guard ngăn các tick chồng nhau gửi trùng trong dispatcher đang chạy.
- LLM bắt buộc inspect treasury trước xin reserve exception. Source-chain RPC thiếu/stale không phải bằng chứng ví đã cạn; từ chối proposal reserve dựa trên observation chưa đầy đủ, cung cấp tool error cho LLM chọn HOLD/chờ worker hoặc xin hỗ trợ vận hành nếu cần. Có FUNDING_REQUIRED thì request_owner_help bị từ chối để LLM đánh giá CCTP trước; backend không tự chọn source/action. Policy limit khác vẫn có thể xin owner ngay, approval chính xác vẫn giữ nguyên.
- Sáu regression mới tái hiện RED trước sửa: unknown request churn, Telegram duplicate unknown, recreated proposal, legacy clock/concurrent tick, reserve trước treasury, owner help dù có funding. Regression mở rộng kiểm tra receipt đổi và stale digest, duplicate request cũ. Tất cả dùng offline fixtures/transport; không có tin nhắn Telegram hay transaction thật từ tests.
- Fresh full checks: local **171/171**, public **176/176**, TypeScript/Vite builds pass; các file chung thay đổi khớp hai repo. Panel được restart trên database suite đã settled sau fresh RPC proof, quyền/budget/expiry giữ nguyên, không xuất thêm scenario hoặc giao dịch. Khác dự kiến ban đầu: giữ process send/bridge flags trong phạm vi đã cấp để treasury tiếp tục quan sát, payout budget còn zero và không có nghĩa vụ mở; không bật .env chính hoặc runtime public.
- Snapshot sau restart lưu tại `data/implementation-verification/notifications-after-fix.json`: zero open owner requests/proposals, zero active exception notifications; bốn tin nhắn lịch sử vẫn sendCount=1, không gửi lại. Tin đã tới Telegram trước sửa được giữ nguyên, không thu hồi từ hộp chat. Chưa tạo thêm tình huống tài chính live để kiểm tra trùng; duplicate/reminder/migration/concurrency được kiểm chứng qua regression, trạng thái settled qua read-only RPC và panel.