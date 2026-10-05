# Installer Agent update — 2026-10-05

Scope: bring the shared Agent cost, recovery and tool-context fixes into the public localhost installer. Preserve its localhost authentication, hidden Windows launcher and existing UI. Hosted demonstration services, deployment configuration, credentials and operator history are outside this release.

Acceptance: offline regressions cover shared primary/reviewer request budgets, durable usage, disabled-model financial boundaries, incomplete responses, retry blocks and tool prerequisites. Existing installer tests and build must pass. A clean public clone must pass checks without configured credentials. Publishing must exclude secrets and runtime data.

Execution and live testnet verification are intentionally separate: this update does not start the Agent, enable providers or submit transactions.

Implemented: shared request accounting and archive; bounded scheduler recovery; batched context reads and tool prerequisites; incomplete-response rejection; testnet financial guards when the model is disabled; environment-file consistency; GPT-5.4 mini defaults and user documentation.

Verification: the old installer failed five focused response/prerequisite regressions before the port. The updated checkout passes all 252 offline tests and the TypeScript/Vite build. Test transports are fixtures, not live providers. Hidden launcher files are preserved. Fresh-clone and publication checks are recorded after publishing.
