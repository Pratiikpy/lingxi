// the tests code addresses under a key of their own, never the one beside a developer's stores (src/pseudonym.ts)
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LINGXI_IP_KEY_FILE ??= join(tmpdir(), "lingxi-test-ip-key");
