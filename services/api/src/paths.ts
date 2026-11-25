/**
 * Where the service's own files are, from source and from the bundle alike: the server runs from src/ through tsx and
 * from dist/ once built, both one folder under the service, so the service's folder is one up from this module's.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
