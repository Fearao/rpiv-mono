import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const omitted = new Set((process.env.npm_config_omit ?? "").split(/[\s,]+/).filter(Boolean));
if (omitted.has("dev")) process.exit(0);

const huskyBin = fileURLToPath(new URL("../node_modules/husky/bin.js", import.meta.url));
if (!existsSync(huskyBin)) {
	console.error(
		"prepare: Husky is missing; run npm install with devDependencies or use npm install --omit=dev for a consumer install.",
	);
	process.exit(1);
}

const result = spawnSync(process.execPath, [huskyBin], { stdio: "inherit" });
process.exit(result.status ?? 1);
