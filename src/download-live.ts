import * as fs from "node:fs";
import { formatTimestampJST, formatTimestampJSTFile, parseDuration, parseTimestamp } from "./time-formats.js";

function parseTimestampOrKeyword(str: string): number | "prev" | "earliest" | "latest" {
	if (str === "PREV") {
		return "prev";
	} else if (str === "EARLIEST") {
		return "earliest";
	} else if (str === "LATEST") {
		return "latest";
	} else {
		return parseTimestamp(str);
	}
}

type TimeRange =
	{
		start: number;
		end: number; // May be Infinity
		duration: undefined;
	} |
	{
		start: "prev" | "earliest";
	} & (
		{
			end: number; // May be Infinity
			duration: undefined;
		} |
		{
			end: undefined;
			duration: number;
		}
	) |
	{
		end: "latest";
	} & (
		{
			start: number;
			duration: undefined;
		} |
		{
			start: undefined;
			duration: number;
		}
	);

function parseTimeRange(str: string): TimeRange {
	const split = str.toUpperCase().split(/\s*(?:\/|--)\s*/);

	if (split.length === 1) {
		try {
			const start = parseTimestampOrKeyword(split[0]);
			if (start === "latest") throw null;
			return {
				start,
				end: Infinity,
				duration: undefined,
			};
		} catch { }
		try {
			const duration = parseDuration(split[0]);
			const now = Date.now();
			return { start: now - duration, end: now, duration: undefined, };
		} catch { }
	} else if (split.length === 2) {
		try {
			const start = parseTimestampOrKeyword(split[0]);
			if (start === "latest") throw null;
			const end = parseTimestamp(split[1]);
			return { start, end, duration: undefined };
		} catch { }
		try {
			const start = parseTimestampOrKeyword(split[0]);
			if (start === "latest") throw null;
			const duration = parseDuration(split[1]);
			if (typeof start === "number") {
				return { start, end: start + duration, duration: undefined};
			} else {
				return { start, end: undefined, duration};
			}
		} catch { }
		try {
			const duration = parseDuration(split[0]);
			const end = parseTimestampOrKeyword(split[1]);
			if (end === "prev" || end === "earliest") throw null;
			if (typeof end === "number") {
				return { start: end - duration, end, duration: undefined};
			} else {
				return { start: undefined, end, duration };
			}
		} catch { }
	}
	throw new SyntaxError(`Malformed time range: ${str}`);
}

if (process.argv.length !== 4) {
	console.error(`
Syntax: node download-live.js <output directory> <time range>

Input time in JST unless otherwise specified.

<time range> examples:
    Download from 2023-11-10 12:30:00 JST to 2023-11-10 12:40:00 JST:
        2023-11-10T12:30:00/2023-11-10T12:40:00
    Download 10 minutes starting from 2023-11-10 12:30:00 JST (same as above):
        2023-11-10T12:30:00/10m
    Download 1 hour ending at 2023-11-10 12:30:00 JST:
        1h/2023-11-10T12:30:00
    Download from 2023-11-10 12:30:00 JST until now:
        2023-11-10T12:30:00
    Download the latest 1 hour, 2 minutes and 3.456 seconds:
        1h2m3.456s
    Download from 2023-11-10 12:30:00 UTC until now:
        2023-11-10T12:30:00+00:00
    Download from 2023-11-10 12:30:00 CET (UTC+01:00) until now:
        2023-11-10T12:30:00+01:00
`);
	process.exit(1);
}

let dir = process.argv[2];
if (dir.endsWith("/") || dir.endsWith("\\")) dir = dir.slice(0, -1);

const streams = [
	{
		position: "tl",
		hash: "ba30e440828e43d28abd720f8d41f3c6"
	},
	{
		position: "bl",
		hash: "e253daf9e2aa4759b51fd8a64dd49786"
	},
	{
		position: "ce",
		hash: "e2a54d45912b4d778066066912f95904"
	},
	{
		position: "tr",
		hash: "3d44c0bd7fc54198a92213402ed400b4"
	},
	{
		position: "br",
		hash: "a9b4aacbe7da4af6a61111c10f21a024"
	},
];


let stop = false;

const lastFilesEndTimestamps = new Map<string, number>();
const timeRange = parseTimeRange(process.argv[3]);

if (timeRange.start === "prev") {
	const fileTimestampRegex = /(?<=--)2023-.*?(?=_)/;
	const filenames = fs.readdirSync(dir);
	for (const stream of streams) {
		const streamFilenames = filenames.filter(f => f.endsWith(`_${stream.position}.mts`) && fileTimestampRegex.test(f)).sort();
		if (streamFilenames.length === 0) {
			throw new Error(`There are no files in the directory for the ${stream.position} monitor.`);
		}
		const filename = streamFilenames.sort().at(-1)!;
		const endTimestamp = new Date(filename.match(fileTimestampRegex)![0].replaceAll(";", ":") + "Z").getTime() - 9 * 60 * 60 * 1000;
		if (Number.isNaN(endTimestamp)) throw new Error("Failed to parse filename");
		lastFilesEndTimestamps.set(stream.position, endTimestamp);
	}
}

type Chunk = {
	timestamp: number;
	length: number;
	path: string;
};

for (const { position, hash } of streams) {
	(async () => {
		const url = `https://bcovlive-a.akamaihd.net/${hash}/us-east-1/6415716420001/profile_0/`;

		const playlist = await (await fetch(url + "chunklist_dvr.m3u8")).text();

		const lines = playlist.split("\n");
		const chunks: Chunk[] = [];

		{
			let timestamp!: number, length!: number;
			for (const line of lines) {
				if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
					timestamp = new Date(line.slice(25)).getTime();
					if (chunks.length > 0 && timestamp !== chunks.at(-1)!.timestamp + 6000) {
						console.warn("Non-fatal assertion failed: Chunk timestamp difference isn't 6 seconds.", timestamp - chunks.at(-1)!.timestamp, chunks.at(-1), timestamp);
					}
				} else if (line.startsWith("#EXTINF:")) {
					length = Number.parseFloat(line.slice(8)) * 1000;
				} else if (!line.startsWith("#")) {
					const chunk = { timestamp, length, path: line };
					chunks.push(chunk);
					if (length !== 6000) {
						console.warn("Non-fatal assertion failed: Length of chunk isn't 6 seconds.", chunk);
					}
				}
			}
		}

		let startAt: number, endAt: number;
		if (timeRange.end === "latest") {
			endAt = chunks.at(-1)!.timestamp + chunks.at(-1)!.length;
			startAt = timeRange.duration !== undefined ? (endAt - timeRange.duration) : timeRange.start;
		} else {
			if (timeRange.start === "prev") {
				startAt = lastFilesEndTimestamps.get(position)!;
			} else if (timeRange.start === "earliest") {
				startAt = chunks[0].timestamp;
			} else {
				startAt = timeRange.start;
			}
			endAt = timeRange.duration !== undefined ? (startAt + timeRange.duration) : timeRange.end;
		}

		let startIndex = 0;
		// If the start timestamp coincides with the chunk start timestamp, include it
		for (; startIndex < chunks.length && chunks[startIndex].timestamp + chunks[startIndex].length <= startAt; startIndex++);

		let endIndex = chunks.length;
		// If the end timestamp coincides with the chunk start timestamp, don't include it
		for (endIndex = chunks.length - 1; endIndex >= startIndex && chunks[endIndex].timestamp >= endAt; endIndex--);
		endIndex++;

		if (startIndex >= endIndex) {
			console.log(`Nothing to download.  pos: ${position}  requested start: ${formatTimestampJST(startAt)}  latest chunk available: ${chunks.length === 0 ? "(no chunks)" : formatTimestampJST(chunks.at(-1)!.timestamp)}`);
		} else {
			console.log(`\
[START] pos: ${position}
    earliest chunk available: ${formatTimestampJST(chunks[0].timestamp)}
${timeRange.start !== "prev" ? "" : `\
    end of previous file:     ${formatTimestampJST(startAt)}\n`}\
    start of this file:       ${formatTimestampJST(chunks[startIndex].timestamp)}
    end of this file:         ${formatTimestampJST(chunks[endIndex-1].timestamp + chunks[endIndex-1].length)}
${timeRange.start !== "prev" ? "" : startAt === chunks[startIndex].timestamp ? `\
    no gap
` : `\
    there's a gap between this and the previous file!
`}`.slice(0, -1));
			const filename = `${dir}/PARTIAL_${formatTimestampJSTFile(chunks[startIndex].timestamp)}_${position}.mts`;
			const stream = fs.createWriteStream(filename);

			// Backpressure is fun
			let i = startIndex;
			async function write() {
				let ok = true;
				while (i < endIndex && !stop && ok) {
					const chunk = chunks[i];
					let data;
					let errored;
					do {
						try {
							data = new Uint8Array(await (await fetch(url + chunk.path)).arrayBuffer());
							errored = false;
						} catch (err) {
							console.error(err);
							errored = true;
							await new Promise((res) => { setTimeout(res, 1000); });
						}
					} while (errored);
					console.log(position, formatTimestampJST(chunk.timestamp), chunk.path);
					ok = stream.write(data);
					i++;
				}
				if (i < endIndex && !stop) {
					stream.once("drain", write);
				} else {
					const endTimestamp = chunks[i - 1].timestamp + chunks[i - 1].length;
					console.log(`[END]  pos: ${position}  end of this file: ${formatTimestampJST(endTimestamp)}`);
					fs.renameSync(filename, `${dir}/${formatTimestampJSTFile(chunks[startIndex].timestamp)}--${formatTimestampJSTFile(endTimestamp)}_${position}.mts`);
				}
			}
			write();
		}
	})();
}

process.once("SIGINT", () => {
	console.log("stopping");
	stop = true;
})