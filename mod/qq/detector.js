import pkg from "profanity-guard";
import SensitiveWordTool from "sensitive-word-tool";

export class Detector {
	static wordTool = new SensitiveWordTool();
	static maxBytes = 1024;
	static _profanityCheck = pkg.profanityCheck;

	static detect(rawText) {
		if (!rawText || typeof rawText !== "string") {
			return { passed: true, reason: null };
		}

		if (Buffer.byteLength(rawText, "utf8") > this.maxBytes) {
			return { passed: false, reason: `文本超过字节限制`, raw: rawText };
		}

		try {
			const enResult = this._profanityCheck(rawText);
			if (enResult) {
				return { passed: false, reason: "多语言敏感词命中", raw: rawText };
			}
		} catch {}

		try {
			const zhResult = this.wordTool.check(rawText);
			if (zhResult) {
				return { passed: false, reason: "中文敏感词命中", raw: rawText };
			}
		} catch {}

		return { passed: true, reason: null, raw: rawText };
	}
}
