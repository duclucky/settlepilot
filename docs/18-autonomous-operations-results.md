# Triển khai Agent tự hành — 2026-10-03

Phạm vi: kế hoạch [17-autonomous-operations-plan.md](17-autonomous-operations-plan.md), local `C:\catooon` và public `C:\catooon-public`. Lõi M0–M3 đã triển khai; M4 có bằng chứng offline. **Chưa nghiệm thu vòng kín mới bằng GPT-5.4/Jev và giao dịch thật, bảy route CCTP live hoặc quan sát 24 giờ.** Các giao dịch lịch sử không được dùng thay bằng chứng cho luồng mới.

## Hành vi hiện tại

| Hạng mục | Đã triển khai | Giới hạn nghiệm thu |
|---|---|---|
| Nguồn nghiệp vụ | Connector thư mục JSON/CSV, schema/revision/hash, provenance, party mapping, dedup, quarantine, acceptance có thẩm quyền | Chưa có hệ thống upstream thực được cung cấp; đây không phải tích hợp ERP hoàn chỉnh |
| Quan sát ví | Finalized checkpoint riêng từng chain, receipt canonical, Arc system/ERC-20 dedup, phân loại customer/internal/mint, phân bổ partial/overpayment | Opening balance không phải doanh thu. RPC thiếu finalized hoặc reorg dẫn tới dừng an toàn; chưa có automatic rollback |
| Tự thức dậy | Durable jobs, deadline window/soon/due, lease/fencing/heartbeat, retries có giới hạn, restart recovery, coalescing, wakeup khi dữ liệu đổi trong run | SQLite aggregate giới hạn MVP; chưa đo production load hoặc chạy soak 24 giờ |
| Owner | Một ActionQueue, Approve/Cancel/Comment, digest/binding/version/expiry, response idempotency, authenticated owner, receipt association, delay theo chỉ dẫn | Comment không cấp quyền chi. Operational review không có Approve. Unknown provider outcome chưa tự khôi phục nếu không có correlation đáng tin |
| LLM | Policy, skills, memory, evidence, treasury, scoped owner responses, defer/match/help tools; LLM chọn CCTP source | Unit/fault tests dùng model fixture, không chứng minh chất lượng quyết định GPT live |
| Telegram | Outbound-only, nội dung chung theo cấp độ/reminder; requests mới nối cùng service | Chưa gửi thông báo Telegram mới trong lượt triển khai này; test dùng transport fixture |
| Public | Session ownership, DTO allowlist, scenario admission/ledger/cooldown/reservations bền vững, enqueue dùng scheduler chung; host admin loopback | Chưa publish/deploy; wallet/API readiness đang khóa Test Lab. Visitor không được phê duyệt ví host |

Giữ cấu hình tài chính hiện hành: `SEND_ENABLED=false`, `BRIDGE_ENABLED=false`, policy/bridge chưa bật; authority đã hết hạn `2026-09-28T17:10:45.431Z`. Không sửa `.env` live, không gửi transaction, không tạo commit/remote/deployment trong lượt này. Server kiểm tra UI riêng chạy simulation, không gọi model, Circle, CCTP hoặc Telegram.

## Kiểm chứng

- Local: `npm test` **151/151 pass**, `npm run build` pass.
- Public: `npm test` **156/156 pass**, `npm run build` pass.
- Hai repo: **50/50 predicate offline pass**. Các adapter model/provider/chain là fixture có nhãn, gồm CCTP fault fixtures; **0 live receipt được tuyên bố**.
- Verifier riêng đọc lại 50 database mỗi repo, kiểm tra idempotency/invariants. Unknown-outcome fixtures cố ý giữ unresolved và không dispatch lại.
- Chrome ở server simulation riêng: Comment được ghi nhận trước reassess; Cancel chuyển request sang REJECTED, không tự tạo dispute hoặc mở lại đề xuất không đổi. Viewport 375×812 có content/client width 360, không tràn ngang; viewport được reset sau kiểm tra.
- Public Chrome: Test Lab hiển thị pipeline và form điều kiện, nút chạy disabled khi hạ tầng chưa ready; viewport mobile không tràn ngang. Local và public common code/tests đối chiếu SHA-256 giống nhau, trừ các file khác biệt sản phẩm đã được giữ riêng. Schema example đã được thử qua ingestion trong memory, không tạo intent.
- Panel chính `http://127.0.0.1:4317` đã khởi động với code mới: runtime testnet, planner `AI · gpt-5.4 + Jev jev-latest`, send/bridge/autonomy/policy disabled, authority expired, không pending intent/bridge. Đây là kiểm chứng cấu hình và read-only runtime, không phải một quyết định LLM mới. Scanner 7/8 chain healthy; Polygon Amoy DEGRADED do probe RPC chainId/finalized gặp DNS `ENOTFOUND`, worker retry có backoff. Không sửa endpoint hoặc claim route này đã nghiệm thu.
- Regression đã bắt được: fingerprint đổi chỉ vì block polling; thiếu continuation khi cap CCTP cần nhiều lượt cùng chain; pending mint bị nhận nhầm unknown; coalescing mất deadline wakeup; CSV boolean không hợp lệ; scenario public cũ không được retire; source có recipient ngoài allowlist không có owner request; thiếu đường LLM xin chỉ dẫn khi không có phương án.

Artifact suite:

| Repo | Suite | Báo cáo và proof |
|---|---|---|
| Local | `078d7090-92d7-4fb2-a3a1-60d782992148` | `data/autonomous-audit/078d7090-92d7-4fb2-a3a1-60d782992148/report.md`, `receipt-verification.json` |
| Public | `dce25995-af1f-4084-8b2e-d8771020e6ee` | `data/autonomous-audit/dce25995-af1f-4084-8b2e-d8771020e6ee/report.md`, `receipt-verification.json` |

Mỗi suite có manifest seed 5404, predicate 50 ca, summary, sanitized `events.jsonl` và SQLite riêng từng ca. Test output lưu ở `data/implementation-verification/tests-final.txt` trong từng repo. Screenshot local: `data/implementation-verification/owner-cancel-simulation.jpg`, `panel-current.jpg`; public: `data/implementation-verification/test-lab-preview.jpg`. `data/` bị Git ignore; artifacts không chứa credentials. Bằng chứng raw transaction được giữ trong DB cần thiết cho proof; JSONL redacts secret-like text.

## Thiết lập nguồn một lần

Trong localhost **Authority & connections → Automatic operations**, cấu hình thư mục export và bật automatic evaluations. Chỉ grant structured acceptance khi nguồn nghiệp vụ đó có thẩm quyền. Đây là thiết lập kết nối; người dùng không phải nhập hash/chain/amount/provider ID mỗi ngày.

Upstream tự xuất JSON theo [schema example](../examples/source-export.example.json). `sourceId` và `externalId` ổn định; `revision` tăng khi đổi nội dung. Amount là decimal string tối đa sáu chữ số thập phân, backend chuyển thành integer micro-USDC. Party address bất biến; contractor phải có trong policy allowlist. Không coi prose “accepted” là acceptance.

CSV chứa header `externalId,revision,kind,partyId,title,amount,due,acceptance,evidence,active`; `active` chỉ `true`/`false`. CSV dùng sourceId `export` và party đã đăng ký từ nguồn JSON. Mỗi file ≤128 KiB, thư mục ≤100 file; không đọc symlink. Producer nên publish bằng atomic rename sau khi ghi xong. Chưa có upstream được cấu hình thì worker hiển thị Not connected, không giả vờ có tích hợp.

Autonomy settings lưu trong SQLite, mặc định disabled, không tự bật send/bridge/authority. Worker vẫn reconcile giao dịch cũ khi pause. Dữ liệu cũ được migration bổ sung, không xóa intent/history. Không tự nhận opening liquidity là khoản khách mới trả.

## Public và host

Public giữ bốn khu vực chung và thêm Test Lab. Test Lab cố định recipient server-side, chỉ nhận 1–5 điều kiện nghiệp vụ, UUID idempotency, deadline/acceptance/evidence. Một ví chỉ có một scenario hoạt động; unresolved intent hoặc owner request chặn case tiếp theo. Scenario hoàn tất được retire an toàn, không xóa lịch sử trả tiền.

Host quyết định trên listener loopback `LOCAL_ADMIN_PORT=4319` mặc định, dùng owner session riêng. Public session token chỉ giữ hash phía server, ownership/cooldown/reservation tồn tại sau restart. Public DTO bỏ memory, tool calls, evidence raw, owner comments, approval authority, Telegram và source path. Browser public không có đường sửa policy, settings, wallet hoặc quyết định owner.

## Chạy audit và gate còn lại

PowerShell từ đúng repo:

```powershell
npm run audit:autonomous
.\node_modules\.bin\tsx.cmd src/audit/verify-autonomous.ts data/autonomous-audit/<suite-id>
.\node_modules\.bin\tsx.cmd src/audit/run-autonomous.ts --mode observe --panel http://127.0.0.1:4317
```

Dùng `tsx.cmd` trực tiếp khi truyền flags trên PowerShell; npm wrapper có thể bỏ các flags. `--resume <suite-id>` giữ manifest/seed, skip case đã hoàn tất và đánh dấu interrupted case cần review; không âm thầm chạy lại DB đã có.

Live harness chỉ publish export trong thư mục đã được host cấu hình và đọc state qua loopback. Nó không gọi LLM trực tiếp, chọn source chain hoặc gửi wallet transaction. Trước live cần:

1. Upstream business source và event manifest, customer deposits thực trong môi trường; không seed số dư giả.
2. Phạm vi wallet/recipient/amount/fee/budget/expiry hiện hành được cấp quyền rõ ràng, send/bridge/policy enabled, autonomy enabled, GPT-5.4 + Jev ready.
3. Run live mới, independent read-only RPC verification của incoming + payout + source burn/Arc mint tạo trong suite; hash cũ không đạt gate. Request owner xử lý ở localhost.
4. Test route thực cho từng source chain được hỗ trợ và soak 24 giờ có restart/RPC/model faults. Chưa có các bằng chứng này thì không đánh dấu kế hoạch end-to-end hoàn tất.

## Nguồn đối chiếu

Đối chiếu ngày 2026-10-03: [Arc USDC system events](https://docs.arc.io/arc/references/usdc-system-events), [Circle CCTP technical guide](https://developers.circle.com/cctp/references/technical-guide), [Polygon Amoy RPC configuration](https://docs.polygon.technology/tools/dApp-development/common-tools/remix/). Scanner và contract fixtures phân biệt 18-decimal system events với 6-decimal ERC-20 events; burn/attestation chưa phải balance có thể payout trên Arc. Endpoint Polygon vẫn được tài liệu liệt kê; lỗi DNS ở máy hiện tại không đủ căn cứ tự đổi registry.

## Chuẩn bị ca live đầu tiên — 2026-10-03

Preflight đã đọc CLI/RPC và chuẩn bị nguồn hai phase incoming → payable, database và quyền chi nhỏ riêng. Polygon Amoy default đã thay endpoint deprecated và probe finalized thành công. Local 152/152 tests, public 157/157 tests và build pass. Công cụ thực thi chặn startup bật send/bridge; chưa có giao dịch mới, policy draft đã disable, scope cụ thể đang chờ user. Chi tiết [19-first-live-test.md](19-first-live-test.md).
## User xác nhận live scope — 2026-10-03

User đã duyệt phạm vi cụ thể và chi testnet; không cần hỏi lại. Công cụ thực thi vẫn chặn startup tài chính (`blocked by policy`, không có lý do chi tiết), nên chưa có transaction mới. `Start-First-Live.ps1` đã chuẩn bị cho owner chạy tại PC; incoming phase precedes payable phase, customer marker chống gửi lại. Sửa verifier Agent SCA payout bằng regression RED/GREEN. Local 153/153 tests, public 158/158 tests và build pass. Bằng chứng và lệnh owner tại [19-first-live-test.md](19-first-live-test.md).
## Live incoming và funding-action correction — 2026-10-03

Khoản customer 0,10 USDC Base mới đã finalized và được Agent allocate đúng invoice; Telegram gửi thành công một lần. Live phát hiện HOLD/selected-source deadlock; sửa FUND_ARC riêng với Jev review và re-plan sau mint, cùng immutable planning snapshot/fresh backend revalidation. Local 161/161, public 166/166 tests và builds pass. Agent đang dừng; công cụ thực thi chặn restart financial runtime. CCTP/payout sau sửa và 50 live chưa xác minh. Bằng chứng, limitations và lệnh resume không resend tại [19-first-live-test.md](19-first-live-test.md).

## Cập nhật hiện tại — live khôi phục 2026-10-03, 21:37 UTC+7

Thay thế trạng thái dừng/chặn ở ghi chú lịch sử: Agent đã tự CCTP Base → Arc 0,045001 USDC, rồi quyết định PAY_NOW và trả 0,05 USDC trên Arc. RPC verifier độc lập xác minh incoming + burn + mint + payout; một payout dispatch, zero unresolved và zero owner request. Arc còn 0,06 USDC. Telegram incoming/CCTP/payout DELIVERED một lần; panel hiện Paid và All obligations are settled.

Sửa ba lỗi live: phí forwarding quote bị coi là trần cố định; sponsored network gas bị coi là chi phí ví; proposal owner cũ không được thu hồi. Giữ hard constraints, policy cap/idempotency/receipt proof; không resend customer/burn hoặc thay reserve. Test cuối local 165/165, public 170/170, builds pass. Tool rejection trước khởi động có nguyên nhân cụ thể chưa xác định; cách gọi Auto-review trước đây không đủ căn cứ và đã được đính chính. Chi tiết nguyên nhân, hashes, regression và artifact tại [19-first-live-test.md](19-first-live-test.md). Đây là một route live sau phục hồi, không phải 50/50 live, all-route validation hay soak 24 giờ.
## Hoàn tất sửa thông báo trùng — 2026-10-03

Gộp Telegram theo từng vấn đề, dùng một review cho mỗi operation unknown, giữ reminder clock khi snapshot/request ID đổi hoặc restart, dừng nhắc khi resolved. Tăng cấp vẫn gửi ngay; HIGH 30 phút, MEDIUM 6 giờ. LLM inspect treasury trước xin nới reserve, không xin top-up khi có verified CCTP alternative. Approval digest/binding, policy và financial constraints không được nới. Local 171/171 tests, public 176/176 và builds pass. Restart database live đã settled; read-only snapshot zero open request và zero active exception, các thông báo cũ không phát lại. Chi tiết giới hạn và regression tại [19-first-live-test.md](19-first-live-test.md).
## Nâng cấp tự hành trong quyền đã cấp — 2026-10-03

Đã hoàn tất bounded wait bền vững, recovery context cho LLM, owner request theo từng nghĩa vụ và timer/retry scheduler. LLM tiếp tục chọn payment/funding/wait; backend không nâng quyền hoặc thay quyết định. Public giữ isolation và che wait reason/context private. 7 regression mới, local 178/178 và public 183/183 tests, hai builds pass; 50/50 offline. GPT-5.4 + Jev thật kiểm chứng scoped approval vẫn cho phép item khác được chọn PAY_NOW và RPC recovery tự chọn wait/HOLD, không có giao dịch từ verifier. Jev thấp confidence vẫn có thể yêu cầu evidence; không hạ threshold. Panel đã reload database settled, zero open request/pending; scope chi cũ đã hết hạn, không gia hạn hoặc tạo transaction mới. Chi tiết và artifacts: [20-autonomy-upgrade.md](20-autonomy-upgrade.md).