# Kế hoạch hoàn thiện Agent tự hành — bốn hạng mục

Ngày: 2026-10-03 (Asia/Bangkok). Trạng thái: **ĐÃ TRIỂN KHAI lõi M0–M3 và kiểm chứng M4 offline; gate live/24 giờ chưa đạt**. Kết quả và giới hạn tại [18-autonomous-operations-results.md](18-autonomous-operations-results.md).

Kế hoạch áp dụng cho `C:\catooon` (local operator) và `C:\catooon-public` (public sandbox). User đã yêu cầu triển khai kế hoạch. Coding và kiểm chứng không bật quyền chi, gửi giao dịch hoặc deploy; các gate đó vẫn được ghi riêng.

## 1. Kết quả cần đạt

Sau cấu hình ban đầu, Agent tự nhận dữ liệu nghiệp vụ và quan sát ví, tự thức dậy khi tình hình thay đổi, đọc policy/skill/memory, quyết định bằng LLM, thực thi qua backend và xác minh kết quả. Người dùng chỉ xử lý ngoại lệ: phê duyệt đề xuất cụ thể, từ chối đề xuất hoặc gửi ý kiến/chỉ dẫn bằng ngôn ngữ tự nhiên.

Luồng nghiệm thu: nguồn nghiệp vụ → đồng bộ hồ sơ → sự kiện onchain → xác minh và ghép khoản thu → đánh thức Agent → GPT-5.4/Jev → chọn nguồn CCTP nếu cần → mint được xác minh → quan sát lại → payout → receipt được xác minh → cập nhật panel và Telegram.

Không yêu cầu người dùng nhập chain, hash, wallet, amount hoặc provider ID trong vận hành thường ngày. Cấu hình kết nối một lần vẫn cần. Test Lab công khai được nhập điều kiện nghiệp vụ, không nhập số dư giả hoặc ép quyết định Agent.

Giữ phạm vi một doanh nghiệp, một ví vận hành mỗi môi trường, canonical USDC, trả contractor trên Arc Testnet 5042002. Nguồn CCTP là bảy EVM testnet trong registry hiện có. Không thêm mainnet, token/bridge tùy ý, custom contract, marketplace, hệ thống kế toán đầy đủ hoặc nhiều agent.

## 2. Hiện trạng đã đối chiếu với code

| Bằng chứng | Đã có | Khoảng trống phải đóng |
|---|---|---|
| `src/revenue.ts`, `src/crosschain-revenue.ts` | Theo dõi khoản thu đăng ký trước; dedup và gọi adaptive loop | Reader lọc sẵn sender + amount; chưa tự khám phá tất cả khoản vào ví, chưa có nguồn nghiệp vụ tự đồng bộ |
| `src/server.ts` | Tick 5 giây cho reconcile, monitor và Telegram | Một chuỗi await chung trong một try/catch; lỗi bước trước có thể bỏ bước sau; chưa có job/lease bền vững cho deadline và sự kiện |
| `src/store.ts` | SQLite transaction, financialVersion, durable intent | Financial fingerprint gồm block và inventory; nếu thêm polling thường xuyên mà không đổi thiết kế có thể vô hiệu kế hoạch/approval liên tục |
| `src/adaptive.ts`, `src/engine.ts` | LLM chọn PAY/HOLD/evidence/source chain; CCTP, payout, receipt | Chưa có một bộ điều phối duy nhất cho tất cả nguồn đánh thức; cần nối lại sau restart và chống lặp quyết định khi không đổi tình hình |
| `src/user-decision.ts`, `src/app.ts` | Hai loại request và hai endpoint resolve | Cancel policy = KEEP_POLICY; Cancel evidence = DISPUTED. Chưa có semantics từ chối thống nhất, chỉ dẫn độc lập, expiry đầy đủ cho mọi loại request |
| `src/web/main.tsx` | UI vận hành đã bỏ input kỹ thuật | Chữ “tự động” hiện vượt bằng chứng: chưa có connector nhận nghĩa vụ tự động; Comment còn bắt buộc và gắn với nút quyết định |
| Public `src/app.ts`, `src/public-test-lab.ts` | Test Lab dùng giới hạn host; mutation ngoài Test Lab bị chặn | Phê duyệt trên public đang bị khóa; điều phối global/in-memory và scenario lifecycle phải nối vào scheduler mới |
| `src/audit/run-50.ts` | Runner, JSONL, resume và payout verification | Runner cũ thay state rồi gọi `engine.run()` trực tiếp; không chứng minh nhận sự kiện tự động hoặc luồng CCTP đầy đủ |

Số test đã báo trước đây (81 local, 84 public) là bằng chứng lịch sử, không phải kết quả chạy ngày 2026-10-03. Không dùng việc build pass để khẳng định tự hành end-to-end.

## 3. Quyết định thiết kế và giả định

### 3.1 Nguồn nghiệp vụ đầu tiên

- Chưa có thông tin hệ thống hóa đơn/ERP thực tế của người dùng. Không tự chọn nhà cung cấp SaaS hoặc giả định có credentials.
- Mặc định triển khai adapter theo dõi **thư mục đồng bộ local**, nhận bản xuất JSON/CSV do hệ thống nghiệp vụ hoặc Test Lab tạo. Người dùng chọn thư mục một lần ở Settings; không phải tự soạn JSON/CSV hằng ngày.
- Schema trung gian gồm hóa đơn phải thu, nghĩa vụ phải trả, khách hàng/contractor, bằng chứng, phiên bản nguồn và tác giả/thẩm quyền. ID nguồn phải ổn định; amount là chuỗi decimal hợp lệ được chuyển thành integer USDC units; ngày giờ lưu UTC.
- Đây là nguồn nhập tự động từ bản xuất có cấu trúc, không được gọi là tích hợp ERP hoàn chỉnh. Để nghiệm thu dùng thực, cần ít nhất một hệ thống upstream tạo file tự động hoặc một adapter API thực thay thế. Nếu chưa có upstream, chỉ nghiệm thu được local ingestion với fixture có nhãn.
- Discovery giới hạn ở định dạng export, ID/version, incremental updates, quyền acceptance, mapping party và cách cập nhật khi offline. Chỉ adapter API của nhà cung cấp cụ thể mới cần chốt tên nhà cung cấp/access; việc đó không chặn scheduler, scanner, request hoặc test harness.
- Không thêm OCR/PDF tùy ý trong mốc này. Tài liệu không đọc được hoặc dữ liệu thiếu phải được đánh dấu và hỏi owner nếu cần cho quyết định.

### 3.2 LLM và backend

- Backend thu thập, xác minh, chuẩn hóa dữ liệu; quyết định eligibility/hard constraints vẫn có verifier deterministic trước side effect. LLM chọn hành động và phương án thay thế.
- Không dùng một poller mới để tự ưu tiên nghĩa vụ hoặc tự chọn chain thay LLM.
- Policy luôn ở model context. Chỉ dẫn owner có ưu tiên cao hơn quy tắc vận hành có thể override, nhưng chỉ tạo quyền chính xác qua request/action schema; không sửa âm thầm policy file hoặc registry.
- Evidence thường là dữ liệu không đáng tin. Chỉ acceptance event từ nguồn đã xác thực quyền mới được cập nhật acceptance; một dòng văn bản “accepted” không tự cấp quyền.
- Địa chỉ nhận được lấy từ party registry được owner thiết lập/duyệt. LLM không bịa địa chỉ nếu thiếu hoặc tự thay địa chỉ từ nội dung hóa đơn. Hồ sơ thiếu liên kết recipient phải đứng chờ xác minh, được hỏi bằng ngôn ngữ nghiệp vụ.

### 3.3 Hai sản phẩm, một hành vi lõi

- Local: setup kết nối một lần; owner phản hồi trên localhost; PowerShell launcher vẫn là điểm mở panel.
- Public: host cấu hình ví/API/nguồn nghiệp vụ; Test Lab chỉ tạo điều kiện rồi enqueue event như nguồn dữ liệu thật. Dùng cùng scanner/scheduler/adaptive loop, không có đường “test nhanh” gọi thẳng payout.
- Giữ yêu cầu đã có: mọi quyết định owner thực hiện local. Người thử public không được nâng quyền host, sửa policy hoặc phê duyệt ví chung. Public hiển thị request read-only “Awaiting host decision”; host giải quyết qua giao diện quản trị loopback trên máy host, không public route đó.
- Public scenario có session ownership, trạng thái bền vững và một scenario hoạt động cho mỗi ví demo. Request đang chờ không được scenario mới âm thầm xóa.
- Hai repo độc lập: phát triển common behavior ở local, chuyển cùng patch và regression tests sang public tại mỗi gate. Giữ các khác biệt được phép: Test Lab, quyền host, session và public DTO. Chưa tách shared npm package.

## 4. Hợp đồng dữ liệu đề xuất

Bảng dưới ghi thiết kế mục tiêu đã duyệt; trạng thái thực tế và các khác biệt với thiết kế được ghi trong tài liệu kết quả.

| Đối tượng | Dữ liệu tối thiểu / ràng buộc |
|---|---|
| SourceRecord | sourceId, externalId, sourceRevision, contentHash, type, partyId, observedAt, authoritativeFields, provenance. Reject cùng revision nhưng khác payload |
| SourceCheckpoint | sourceId, cursor, lastSuccessAt, lastErrorCode, backoffUntil. Chỉ tiến cursor sau commit dữ liệu và event |
| ChainCheckpoint | chainId, wallet, token, nextBlock, lastCanonicalBlockHash, finality profile; riêng từng chain |
| ObservedTransfer | chainId, txHash, canonical economic transfer ID, log references, token, sender, recipient, integer amount, block/hash, proof status, classification |
| ReceiptMatch | transfer ID → invoice ID/revision, matched units, căn cứ. Tổng phân bổ không vượt transfer/invoice; tiền vào không làm tăng snapshot bằng cộng số học |
| WakeEvent / AgentJob | unique dedupeKey, cause, scope, dueAt, status, attempts, leaseOwner/leaseUntil, fencing token, runId, errorCode, relevant-state fingerprint |
| ActionRequest | requestId, kind, scope, exactAction, actionDigest, reason, evidence references, policy/obligation/context versions, owner, expiresAt, status |
| OwnerResponse | responseId, requestId, actionDigest, response kind APPROVE/CANCEL/COMMENT, text nếu có, authenticated actor, timestamp, idempotency key |
| WorkerHealth | worker/source/chain, trạng thái, lastAttempt/lastSuccess, queue lag, safe error code; không có secret/raw provider body |

Trạng thái receipt: OBSERVED → VERIFIED → MATCHED hoặc UNMATCHED; một canonical reversal được gắn REORGED, không xóa lịch sử. Internal transfer/CCTP mint không phải doanh thu khách hàng mới.

Trạng thái request: OPEN → APPROVED / REJECTED / EXPIRED / SUPERSEDED. COMMENT lưu phản hồi và chuyển sang REASSESSING; khi đã tạo phương án mới thì SUPERSEDED request cũ, không cấp approval cho phương án mới.

Trạng thái job: READY → LEASED → DONE; lỗi đọc/planning có thể RETRY_AT, cuối cùng NEEDS_ATTENTION. Unknown financial submission luôn đi reconciliation, không biến thành job gửi lại.

Giữ SQLite một aggregate cho MVP. Bổ sung collection/checkpoint và giao dịch nguyên tử trong Store trước; nếu kích thước đo được vượt giới hạn, mới tách job table trong cùng DB và cùng transaction. Không thêm Redis/queue service.

## 5. Trình tự thực hiện và phụ thuộc

M0 (baseline, migration, model dữ liệu) → M1A (nguồn nghiệp vụ) + M1B (chain discovery) → M2 (scheduler) → M3 (owner request) → M4 (nghiệm thu vòng kín). Có thể thiết kế request song song về mặt tài liệu, nhưng thực thi theo các gate; không mở thêm agent hoặc repo.

| Gate | Deliverable phải review được | Điều kiện qua |
|---|---|---|
| M0 | Baseline + migration an toàn + hợp đồng version | Dữ liệu cũ đọc được, không mất intent/approval/history; không vô tình bật tài chính |
| M1 | Đồng bộ nguồn và khám phá khoản vào ví | Không nhập kỹ thuật; dedup/cursor/provenance đúng; chưa gọi side effect |
| M2 | Event/schedule → LLM run tự động | Không mất wakeup, không gửi trùng, không gọi model liên tục lúc idle |
| M3 | Approve/Cancel/Comment đúng semantics | Quyền gắn action cụ thể; denial được tôn trọng; comment không tự cấp quyền |
| M4 | Report end-to-end + 50 scenario + receipt proof | Mỗi tuyên bố có artifact; phân biệt live/mock/skipped; không lấp chỗ thiếu bằng hash cũ |

### M0 — Baseline và migration

**File:** `src/domain.ts`, `src/store.ts`, `src/config.ts`, `tests/policy.test.ts`, `tests/engine.test.ts`; mới `tests/state-migration.test.ts`; docs 01/03/14/16 và tài liệu này ở cả hai repo.

1. Ghi nhận phiên bản source/dependencies, chế độ runtime và các flag hiện hành bằng thông tin không có secret. Không đổi send/bridge/policy enabled khi triển khai.
2. Đọc tài liệu network/SDK chính thức trước khi sửa scanner, finality, provider-history; đối chiếu installed types. Chốt supported transfer shapes bằng contract fixtures, không mặc định một receipt có duy nhất một Transfer.
3. Thêm schemaVersion và migration idempotent cho record/event/job/request mới. Dữ liệu lịch sử giữ nguyên ID và resolution cũ; legacy request có action không đủ rõ phải chuyển SUPERSEDED, yêu cầu Agent dựng đề xuất mới, không tự chuyển thành approval mới.
4. Tách semantic decision fingerprint khỏi observation freshness. Block/time/checkpoint/heartbeat đổi không được tự tạo nghĩa vụ mới hoặc kích hoạt LLM. Amount, recipient, evidence authoritative, quyền, balance khả dụng, reservation hoặc fee bound thay đổi vẫn phải revalidate/replan tương ứng.
5. Review đồng thời `executePlanned`, `policy.ts`, `user-decision.ts`, gateway authorization để không nới lỏng freshness checks khi đổi version semantics. Mỗi execution vẫn đọc balance/chain/authority mới.
6. Backup SQLite nhất quán bằng SQLite backup/checkpoint khi dừng writer, không chỉ copy file .db đang có WAL. Rollback cần dừng writer, giữ intent đã submit và reconcile trước; không restore bản backup cũ sau khi đã có giao dịch mới.

**Nghiệm thu:** migrate hai lần cùng kết quả; pending intent không gửi lại; restart không bật send; chỉ đổi block/time không làm vòng replan vô hạn; balance/recipient/evidence thực đổi làm approval/plan mất hiệu lực theo binding đã chốt.

### M1A — Tự nhận dữ liệu nghiệp vụ

**File mới đề xuất:** `src/sources/types.ts`, `src/sources/local-export.ts`, `src/ingestion.ts`, `tests/ingestion.test.ts`, `tests/source-local-export.test.ts`.

**File tích hợp:** `src/domain.ts`, `src/store.ts`, `src/config.ts`, `src/app.ts`, `src/web/main.tsx`; public thêm `src/public-test-lab.ts`.

1. Định nghĩa normalized schema và mapping từ một export đã biết. Connector nhận party IDs, nguồn, số tiền/hạn trả, revision và authority; không đưa technical payment fields cho owner điền thường ngày.
2. Adapter chỉ đọc thư mục được cấu hình, không theo path từ nội dung tài liệu; giới hạn file size/count, bỏ symlink ngoài root, nhận atomic file completion, phát hiện ghi dở. Dùng periodic scan làm nguồn tin chính; filesystem event chỉ hỗ trợ tốc độ.
3. Normalize Zod schema, decimal chính xác, timestamp/timezone, duplicate ID, revision cũ/mới. Source malformed đưa vào quarantine có lý do; không chặn các record tốt khác.
4. Upsert obligation/receivable/evidence theo external identity, lưu provenance. Bản cập nhật tăng đúng version; replay không tăng. Hồ sơ đã trả không bị sửa thành chưa trả. Source deletion là đề nghị đóng/hủy có trace; không xóa lịch sử.
5. Source update trong khi có intent đang submit được lưu như amendment chờ đối soát; không sửa intent frozen hoặc gửi khoản thay thế ngay.
6. Tạo event cùng transaction với thay đổi nghiệp vụ; giai đoạn đầu chỉ lưu event để kiểm tra, M2 mới tiêu thụ.
7. Hiển thị nguồn đã nối, lần đồng bộ cuối, record lỗi và “Not connected” thật. Không ghi “continuously monitoring” khi thiếu connector hoặc worker chưa chạy.
8. Test Lab tạo cùng loại SourceRecord từ điều kiện scenario qua adapter riêng. Không dùng thư mục local của host cho input public, không nhận path tùy ý.

**Nghiệm thu:** file nguồn mới/sửa tự cập nhật hồ sơ; không có thao tác form nghĩa vụ; 10 lần replay chỉ một nghĩa vụ; sai amount precision không được nhập; văn bản prompt injection không đổi quyền; nguồn không có quyền acceptance không tự đánh dấu accepted; trả lời owner giải thích thiếu liên kết, không yêu cầu paste hash.

### M1B — Tự phát hiện và phân loại tiền vào đa chain

**File mới đề xuất:** `src/chain-observer.ts`, `src/receipt-matching.ts`, `tests/chain-observer.test.ts`, `tests/receipt-matching.test.ts`.

**File thay đổi:** `src/adapters/arc.ts`, `src/adapters/crosschain.ts`, `src/revenue.ts`, `src/crosschain-revenue.ts`, `src/treasury.ts`, domain/store.

1. Bổ sung reader tìm canonical USDC transfer **đến ví vận hành**, không yêu cầu biết sender/amount trước. Verify chain/token/block/receipt độc lập trước khi đưa vào tập verified.
2. Phân biệt raw log identity (`chainId + txHash + logIndex + emitter`) với economic-transfer identity; một tx nhiều transfer không bị gộp nhầm, hai emitter Arc 6/18 decimals không bị tính hai lần. Transfer shape chưa hỗ trợ được giữ UNMATCHED/UNSUPPORTED, không nới verifier cho qua.
3. Checkpoint riêng từng chain; chunk size theo RPC capability, finality/confirmation profile xác minh trong M0, lưu canonical block hash và overlap scan hữu hạn. RPC lỗi không tiến cursor; block reorg rollback phần matching chưa final và re-evaluate quyền chi. Nếu ảnh hưởng giao dịch đã thực thi, dừng phần chi liên quan và escalate, không giả định có thể đảo payout.
4. Khởi tạo checkpoint ở block cố định ngay lúc kết nối; chụp opening balance, rồi quét từ mốc này. Lịch sử trước mốc là opening treasury, không tự tạo doanh thu; backfill chỉ khi có khoảng nguồn rõ ràng. Tiền đến trước khi import hóa đơn nằm trong unmatched queue và được rematch sau đó.
5. Không ghép invoice chỉ vì số tiền trùng. Dùng party mapping, reference/nguồn tin cậy, currency, time window và revision. LLM có thể đề xuất ghép từ evidence; backend kiểm tra tổng và quyền, ambiguity không tự chuyển thành doanh thu đã thu.
6. Hỗ trợ receipt đến nhiều lần/partial/overpayment về mặt ghi nhận: cộng allocation units chính xác, giữ invoice chưa đủ tiền hoặc phần dư unallocated. Mốc này không cho chia nhỏ nghĩa vụ payout hoặc tự refund.
7. CCTP mint, chuyển nội bộ, faucet/top-up phải phân loại riêng. `UNMATCHED` là chưa gán doanh thu, không phải số dư không tồn tại: số dư chi dựa vào onchain snapshot và policy; phần cần quarantine/return được reserve riêng nếu policy quy định, không cộng/trừ lần hai từ revenue ledger.
8. Auto lookup provider transaction/burn evidence chỉ qua SDK/CLI/history có hỗ trợ và exact intent matching. Nếu thiếu provider capability hoặc nhiều kết quả, giữ EXECUTION_UNKNOWN + reservation và phát request; UI không đòi owner tự tìm UUID/hash và backend không resend mù.

**Nghiệm thu:** deposit từ sender chưa đăng ký được phát hiện; hai invoice trùng tiền không bị tự gán; partial payment không báo invoice paid; mint không thành doanh thu mới; 7 source chain + Arc có checkpoint độc lập; một chain RPC lỗi không ngừng các chain khác; restart không mất/nhân đôi receipt.

### M2 — Vòng đánh thức Agent bền vững

**File mới đề xuất:** `src/scheduler.ts`, `src/worker-health.ts`, `tests/scheduler.test.ts`, `tests/worker-isolation.test.ts`.

**File thay đổi:** `src/server.ts`, `src/adaptive.ts`, `src/engine.ts`, `src/app.ts`, `src/store.ts`, Telegram; public `src/public-test-lab.ts` và `src/server.ts`.

1. Wake events: SOURCE_UPDATED, RECEIPT_VERIFIED, RECEIPT_MATCH_CHANGED, MATERIAL_BALANCE_CHANGED, OBLIGATION_WINDOW_ENTERED, DEADLINE_APPROACHING, OWNER_RESPONDED, POLICY_CHANGED, RESUMED, BRIDGE_SETTLED, PAYMENT_SETTLED và HEALTH_RECOVERED liên quan.
2. Mọi trigger ghi event/job trước khi trả API thành công; bỏ gọi `runAdaptive()` trực tiếp từ monitor/resolve/Test Lab. Một dispatcher là nơi gọi adaptive loop sau khi claim job.
3. Claim job + wallet execution lease trong SQLite transaction; lease có heartbeat, fencing token và owner identity. Trước financial dispatch kiểm lại fencing/version. Process cũ hết lease không được tiếp tục gửi; durable intent và dispatch marker vẫn là lớp chống gửi trùng khi provider không hỗ trợ fencing.
4. Coalesce event cùng scope/semantic state trong tối đa 1 giây; một run mỗi ví. Event mới trong lúc run phải được đánh dấu dirty và giữ cho lượt kế; không mất event giữa đọc-state và acknowledgement.
5. Timer deadline lưu `dueAt` UTC bền vững, gồm lúc nghĩa vụ đi vào cửa sổ 14 ngày, trước deadline 24 giờ, tới hạn và request expiry. Restart xử lý timer quá hạn một lần; không replay hàng nghìn tick.
6. Trạng thái idle không gọi model. Cập nhật block/timestamp hoặc retry log không tạo “tình hình mới”. HOLD/AWAITING_USER lưu fingerprint + nextWake; chỉ thay đổi liên quan mới đánh thức. Một request chặn nghĩa vụ liên quan, không khóa vô cớ tất cả nghĩa vụ độc lập.
7. Tách connector/scanner/reconcile/Telegram thành worker độc lập timeout/backoff. RPC lỗi một chain không bỏ Telegram tick. Lỗi phải lưu safe error code + thời điểm; bỏ catch im lặng.
8. Retry chỉ áp cho đọc/planning lỗi tạm thời, tối đa 3 lần với backoff có jitter (mặc định đề xuất 5/15/45 giây); hết lượt chuyển NEEDS_ATTENTION và một request nếu cần. Không có lớp retry độc lập thứ hai trong crosschain monitor.
9. CCTP mint verified và payout settled enqueue wake cùng commit trạng thái. Sau mint, LLM đọc lại Arc balance/obligations, không tái sử dụng PAY_NOW trên snapshot cũ.
10. Khởi động lại phục hồi job, orphan run và checkpoint, reconcile pending intent trước execution mới. Pause dừng tạo side effect mới; watcher/Telegram/reconciliation vẫn hoạt động. Shutdown ngừng claim, lưu checkpoint và chờ có giới hạn; không xóa pending operation.
11. Panel hiển thị Monitoring / Evaluating / Funding / Verifying / Awaiting your input / Paused / Degraded từ worker/run thực, kèm lần quan sát cuối. Không dùng badge “Live” cố định.

**Mục tiêu nghiệm thu, chưa phải cam kết hiệu năng:** scanner cadence 5 giây khi RPC khỏe; event đã commit được claim ≤2 giây lúc idle; không chờ lịch batch sau khi đủ quyền. Đo riêng LLM, CCTP, provider và receipt latency; không hứa end-to-end dưới một giây.

**Nghiệm thu:** 100 event lặp không tạo 100 run/payment; hai process không dispatch trùng; kill ở từng boundary vẫn resume đúng; 10 phút state không đổi không sinh LLM request mới; thiếu tiền trên Arc nhưng có source liquidity đánh thức Agent và cho LLM chọn route; cả ví cạn chuyển chờ hợp lý, không polling LLM vô hạn.

### M3 — Approve, Cancel và Comment có nghĩa chính xác

**File mới đề xuất:** `src/action-requests.ts`, `tests/action-requests.test.ts`, `tests/owner-response-api.test.ts`.

**File thay đổi:** domain/store, `src/user-decision.ts`, `src/agent-escalation.ts`, `src/app.ts`, `src/adapters/model.ts`, `src/policy.ts`, `src/telegram-notifications.ts`, `src/web/main.tsx`, CSS, agent policy/skills.

1. Thống nhất policy exception, acceptance confirmation, ambiguous receipt và operational failure thành typed request. Mỗi request chứa đề xuất cụ thể, lý do Agent chưa tự xử lý được, ảnh hưởng, hạn và action digest; không chỉ một câu hỏi tự do.
2. Hiển thị business summary mặc định: cần quyết định gì, vì sao, hạn và hậu quả. Amount/recipient display name là dữ liệu chỉ đọc khi giúp owner quyết định. Hash/run/version nằm trong chi tiết phụ, không thành form nhập.
3. APPROVE: đồng ý đúng đề xuất và digest đang hiển thị. Ví dụ acceptance approval chỉ xác nhận nghiệm thu, không đồng thời cấp exception vượt reserve. Cần quyền khác thì tạo request riêng. UI không được gọi tất cả approval là “payment sent”.
4. CANCEL: từ chối đề xuất chưa thực thi; lưu REJECTED và denial binding. Không tự đổi acceptance sang disputed, không xóa obligation, không hủy tx đã phát. Nếu đã SUBMITTING/unknown, trả trạng thái cần reconcile và không báo hủy thành công.
5. Đề xuất đã bị từ chối không được LLM gửi lại y nguyên mỗi tick. Denial đi vào context và backend guard trước đúng action. Chỉ owner yêu cầu xem lại hoặc evidence/policy/action thay đổi có ý nghĩa mới mở đề xuất khác; thay block/time không đủ.
6. COMMENT: gửi chỉ dẫn độc lập mà không cần approve/cancel. Ô Comment có nút gửi bên trong và hỗ trợ Ctrl+Enter; chỉ có ba nhóm điều khiển nghiệp vụ Approve, Cancel, Comment. Không thêm trường kỹ thuật. Comment tự nó không cấp allowance hoặc đánh dấu accepted.
7. Bỏ yêu cầu phải gõ comment mới bấm Approve/Cancel nếu đề xuất đã đủ rõ. Log actor + lựa chọn thật, không tự bịa lời giải thích như thể owner đã viết. Comment riêng phải có nội dung. Giữ draft khi API lỗi; disable double submit; cung cấp receipt acknowledgement từ server.
8. Owner reply được cung cấp cho LLM như authenticated instruction có scope request. “Chờ đến mai” có thể tạo đề xuất defer với thời điểm; “ưu tiên B” ảnh hưởng planning. Nếu đổi amount/recipient/quyền, LLM phải tạo structured proposal mới và request tương ứng; không sửa registry từ free text.
9. API đề xuất `POST /api/action-requests/:id/responses` nhận responseId, kind, actionDigest và comment tùy loại; actor từ phiên xác thực, không lấy trong body. Commit response + next job nguyên tử; trả 202 với response/job ID. GET trạng thái dùng panel polling hiện có.
10. Atomic checks: OPEN, chưa hết hạn, đúng owner/scope, đúng action, obligation/policy/balance/reservation context phù hợp, chưa execution. Stale request thành SUPERSEDED, UI giải thích điều gì thay đổi và chờ đề xuất mới. Hai tab gửi đồng thời chỉ một resolution thắng; retry cùng responseId trả cùng kết quả.
11. Migration legacy resolution giữ semantics lịch sử (`KEEP_POLICY`, `DISPUTED`) và nhãn chính xác; không đổi mọi lịch sử thành “Cancelled” vì nhãn nút mới. Compatibility endpoints, nếu giữ tạm, phải đi qua cùng validation và enqueue; public guard vẫn chặn.
12. Telegram lấy trạng thái request mới: NORMAL cho settlement, MEDIUM khi cần owner và chưa sát hạn, HIGH khi trong 24 giờ/đã quá hạn hoặc outcome không rõ. Giữ mặc định nhắc 6 giờ / 30 phút, dedup và tăng cấp; resolved/rejected/superseded dừng nhắc request cũ. Expired chưa giải quyết phải có replacement/escalation phù hợp, không im lặng mất việc.
13. Telegram chỉ chứa severity, loại sự kiện tổng quát và hướng dẫn mở local panel; không amount, wallet, tên, invoice, câu hỏi/ý kiến hoặc command button. Không triển khai inbound bot.

**Nghiệm thu:** approve đúng action một lần; stale/expired bị từ chối; Cancel không gán dispute; Comment không gây send chỉ vì chứa chữ “approve”; chỉ dẫn owner làm LLM đổi phương án đúng scope; reject được tôn trọng sau restart; draft còn khi lỗi; public không resolve host request qua API.

### M4 — Kiểm chứng vòng kín bằng điều kiện, không điều khiển thay Agent

**File mới đề xuất:** `src/audit/autonomous-scenarios.ts`, `src/audit/run-autonomous.ts`, `src/audit/verify-autonomous.ts`, `tests/autonomous-loop.test.ts`, `tests/autonomous-audit-contract.test.ts`.

**File tái sử dụng/thay đổi:** `src/audit/journal.ts`, `src/audit/scenarios.ts`, `src/audit/verify-run.ts`, tests Arc/CCTP/engine/notifications; docs 10/11/03. Không gọi runner cũ là bằng chứng tự hành mới.

1. Harness chỉ tạo nguồn nghiệp vụ, đóng vai khách hàng đưa tiền, phát sinh update/deadline, gây lỗi được gắn nhãn và quan sát. Harness không gọi run/plan/fund/pay, không sửa số dư production, không chọn source chain cho LLM.
2. Live mode dùng GPT-5.4 + Jev thật, wallet/provider thật, source balance thật. Không có âm thầm fallback rules hoặc simulation nếu thiếu credentials; report BLOCKED/NOT_READY rõ ràng.
3. Tách quyền nguồn khách hàng khỏi ví Agent. Tài trợ/faucet/customer transfer là môi trường kiểm thử có attribution, không phải hành động Agent. Harness không có công cụ bypass approval; test owner response giả chỉ trong offline/fault mode có nhãn, live owner branch cần phản hồi thật trên localhost.
4. Triển khai 3 tầng: deterministic tests với virtual clock/fake adapters; observation-only rehearsal với dữ liệu nguồn và RPC thật nhưng execution tắt; live testnet trong quyền chi hiện hành đã được xác minh. Quyền live hết hạn/khác ví phải xử lý trước khi chạy, không mặc định quyền cũ còn hiệu lực.
5. Live rehearsal tối thiểu: deposit Arc mới → tự payout; deposit source chain mới khi Arc thiếu → tự CCTP → mint → tự payout; conflict → request + Telegram → phản hồi local → tự đánh giá lại; wallet cạn → scan mọi chain → HOLD/request hợp lý.
6. Thiết kế 50 scenario tuần tự trước khi chạy, mỗi scenario có ID, điều kiện, event schedule, expected invariants, tập kết quả chấp nhận, timeout và live eligibility. Không khóa expected vào một amount/chain tùy ý nếu nhiều quyết định hợp lệ.

| Nhóm | Số scenario | Các biến thể bắt buộc |
|---|---:|---|
| Nguồn nghiệp vụ | 8 | mới; update; duplicate; out-of-order; malformed; thiếu party; evidence mâu thuẫn; sửa nghĩa vụ đã trả |
| Khoản thu | 8 | Arc; source chain; unknown payer; hai invoice trùng tiền; partial; overpaid; replay; CCTP mint/internal không phải revenue |
| Thanh khoản/CCTP | 10 | Arc đủ; Arc thiếu một nguồn đủ; nhiều nguồn tổng đủ; cần nhiều bridge; source thiếu cả fee; reserve; source RPC lỗi; mọi ví cạn; tiền đến khi đang chờ; mint chậm |
| Thời gian và đánh thức | 8 | vào planning window; gần hạn; tới hạn không có thu mới; update lúc run; coalesce; idle; resume; restart qua deadline |
| Quyết định owner | 8 | approve; cancel; comment-only; stale; expired; double click; hai tab đối nghịch; denial sau restart |
| Phục hồi và cô lập | 8 | mất response payout; mất response burn; reorg có nhãn; LLM lỗi; Jev review/block; Telegram lỗi; process chết sau submit; hai worker tranh lease |
| **Tổng** | **50** | Mỗi case có predicate kết quả cụ thể trước khi chạy |

7. Dùng USDC units tùy số dư thực; ghi seed + generated amounts và immutable manifest trước run. Thiếu tiền vẫn là tình huống hợp lệ để kiểm chứng HOLD, nhưng không tính HOLD là bằng chứng CCTP/payout thành công. Case cần onchain không đủ điều kiện ghi SKIPPED/BLOCKED, không cho PASS giả.
8. Các lỗi reorg/response-loss ép bằng transport fault injection phải gắn nhãn HYBRID_FAULT, kể cả nền có tx thật. Không tuyên bố 50/50 case đều là sự cố tự nhiên hoặc đều có payment.
9. Bảy source chain cần contract/integration fixture riêng. Để gọi live multichain hoàn chỉnh phải có deposit/burn/mint proof theo từng chain; chain chưa được faucet hoặc provider chưa hỗ trợ ghi NOT_VERIFIED. Rehearsal Arc + một source chỉ chứng minh route đó.
10. Verifier độc lập read-only truy nguồn scenario → event → run → action → intent → receipt. Kiểm tra chain/token/recipient/amount, burn+mintage, hash mới thuộc lần chạy, unique economic transfer và không gửi lại. Zero receipt không đủ pass assertion “live payout verified”.
11. Logs bền vững SQLite + JSONL có schemaVersion, suite/scenario/event/job/run/request/intent ID, timestamps UTC, attempt/latency, actor, safe error code và model decision/evidence references. Không ghi raw prompt/provider body mặc định, credentials, RPC URL có token; cả chuỗi tự do phải qua sanitizer, không chỉ lọc tên key.
12. Artifacts đề xuất tại `data/autonomous-audit/<suiteId>/`: manifest.json, events.jsonl, agent.db, checkpoints, receipt-verification.json, summary.json, report.md. Nằm trong ignore, có retention/size cap cho log; không xóa unresolved intent, proof hoặc response trước khi reconcile. Report chia lỗi Agent, lỗi hạ tầng, oracle mismatch và thiếu điều kiện.
13. Resume không replay scenario completed hoặc tạo lại customer transfer; scenario đang chạy được reconcile rồi tiếp tục từ event checkpoint. Sequential nghĩa là một scenario active; pending unknown không bị bỏ qua để chạy case kế tiếp.
14. Quan sát 24 giờ ở chế độ read-only sau bộ test: restart, idle LLM usage, queue lag, worker health, Telegram retry; chỉ nói đủ 24 giờ khi có trace đủ thời gian. Không cần giữ chat hoạt động; không tự tạo automation trong lượt lập kế hoạch.

**Nghiệm thu:** các case offline bắt buộc pass; live có ít nhất một incoming + payout mới và một tuyến CCTP burn/mint/payout mới được verifier xác nhận; không duplicate intent/dispatch, không dispatch trái quyền, không mất wakeup. Nếu có Agent fail hoặc unresolved intent phải ghi rõ và sửa/chạy lại case liên quan trước khi công bố ổn định.

## 6. Public sandbox: các việc bắt buộc đi kèm

1. `PublicTestLab.run()` chuyển thành accept scenario + enqueue; trả ngay scenario/job ID, UI theo dõi lifecycle bền vững. Không gọi adaptive trực tiếp hoặc giữ request HTTP suốt CCTP.
2. Scenario ID/idempotency/session ownership và active-scenario lease nằm trong DB. Không dùng cờ `running` trong một process làm bảo đảm concurrency.
3. Rate/cooldown và daily budget đếm cả reservation/inflight + settled theo ledger của ví. Scenario cap không chỉ tính khoản đã SETTLED rồi bỏ qua intent đang submit.
4. Có request unresolved thì trả NEEDS_HOST_INPUT; scenario mới không được xóa obligation/request đó. Hủy scenario chỉ dừng hành động chưa dispatch; đối soát tài chính vẫn tiếp tục.
5. Public `/api/state` trả DTO allowlist đúng demo/session, không spread nguyên private State gồm memory, nội dung owner và toàn bộ hồ sơ. Phiên public không dùng global local-owner token làm quyền phê duyệt.
6. Common pages cùng visual và trạng thái, host-only controls giải thích quyền rõ ràng. Thiếu model/wallet hiện Not ready, không gọi “real GPT/testnet” khi runtime simulation.
7. Local repo phát hành không chứa database lịch sử/credentials/demo policy đang có quyền; public dùng config và DB riêng. Publish/deploy vẫn là mốc riêng ngoài kế hoạch bốn mục.

## 7. Ma trận kiểm chứng và lệnh

Các lệnh dưới là lệnh đã có trong package.json, chạy trong **mỗi repo** khi tới gate tương ứng:

```powershell
npm test
npm run build
```

Focused tests chạy bằng local binary, ví dụ sau khi file mới được tạo:

```powershell
.\node_modules\.bin\tsx.cmd --test tests/ingestion.test.ts tests/chain-observer.test.ts tests/receipt-matching.test.ts
.\node_modules\.bin\tsx.cmd --test tests/scheduler.test.ts tests/worker-isolation.test.ts
.\node_modules\.bin\tsx.cmd --test tests/action-requests.test.ts tests/owner-response-api.test.ts
```

Với hành vi mới: tạo regression case failing có ý nghĩa → implementation → focused tests → full tests/build tại gate. Không viết test chỉ kiểm tra tồn tại chữ/nút thay cho behavior.

`npm run check:arc` là lệnh read-only hiện có, dùng khi cần đối chiếu runtime. `npm run check:ai` có thể gọi model thật, không nằm trong smoke test tự động của mọi build. `audit:50` cũ không dùng để chứng minh scheduler mới.

Script **đề xuất bổ sung khi M4 được triển khai**: `audit:autonomous` (manifest/mode/resume rõ ràng) và `audit:autonomous:verify` (read-only). Chưa được chạy các tên lệnh này trước khi có implementation. Live mode mặc định tắt, yêu cầu scope testnet/allowlist/amount-fee-budget/expiry hợp lệ và không tự tăng hạn mức.

UI: desktop + viewport 375px, keyboard navigation, draft preservation, pending/disabled/error trạng thái, không tràn ngang; Overview/Payments không có input kỹ thuật; request expiry/rejection không có nút approval còn dùng được; public không có đường bypass quyền qua API.

## 8. Definition of Done và bàn giao

- Có nguồn nghiệp vụ chạy được, ghi rõ loại nguồn thật hay fixture; không gọi zero-input hoàn chỉnh nếu người dùng vẫn phải tạo input kỹ thuật mỗi ngày.
- Có durable discovery/checkpoint cho wallet, receipt classification/matching và balance freshness; không cộng đôi tiền hay gán nhầm invoice.
- Mọi luồng revenue/source/deadline/owner/reconcile đi qua cùng scheduler; LLM vẫn quyết định, backend vẫn kiểm chứng trước side effect.
- Approve, Cancel và Comment hoạt động độc lập theo semantics ở M3; public không lấy quyền owner; Telegram một chiều và không lộ nội dung.
- Hai repo pass checks liên quan; dữ liệu cũ migrate được; report nêu rõ live routes đã xác minh, blocked/skipped và limitation còn lại.
- M4 có receipt mới và trace đủ để chứng minh Agent tự chạy; không dùng log UI hoặc hash cũ làm bằng chứng.
- Cập nhật docs 01/03/14/16 theo kết quả thực, README setup/source và launcher nếu cần; giữ các phần lịch sử có nhãn. Tài liệu này chỉ chuyển gate sang completed khi có link artifact và thời điểm kiểm chứng.

Thứ tự bắt đầu: **M0 → M1 → M2 → M3 → M4**. Quyết định upstream cụ thể còn mở có thể ảnh hưởng adapter M1A và nghiệm thu dùng thực; không cản việc xây phần lõi còn lại. Không tự thêm scope ngoài bốn hạng mục để lấp chỗ thiếu này.
