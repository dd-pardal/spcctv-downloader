function pad(n: number) {
	return n.toString().padStart(2, "0");
}

/**
 * Formats a timestamp in `yyyy-mm-ddThh:mm:ss.mmm`
 * @param timestamp Unix timestamp in milliseconds
 * @returns 
 */
export function formatTimestampJST(timestamp: number) {
	const date = new Date(timestamp + 9*60*60*1000);
	return `\
${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T\
${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}
/**
 * Formats a timestamp in `yyyy-mm-ddThh;mm;ss.mmm`
 * @param timestamp Unix timestamp in milliseconds
 * @returns 
 */
export function formatTimestampJSTFile(timestamp: number) {
	return formatTimestampJST(timestamp).replaceAll(":", ";");
}

export function parseTimestampJSTFile(str: string) {
	return new Date(str.replaceAll(";", ":") + "Z").getTime() - 9*60*60*1000;
}



const timestampRegex = /^(?:(?<year0>202\d)-(?<month0>\d\d?)-(?<day0>\d\d?)|(?<year1>202\d)(?<month1>\d\d)(?<day1>\d\d))(?:T|\s+)(?:(?<hours0>\d\d?):(?<minutes0>\d\d?):|(?<hours1>\d\d)(?<minutes1>\d\d))(?<seconds>\d\d?(?:[.,]\d+)?)?(?<utcOffset>[+-](?:\d\d:?\d\d)|Z)?$/i;
const durationRegex = /^P?T?(?:(?<hours>\d\d?)H)?\s*(?:(?<minutes>\d\d?)M)?\s*(?:(?<seconds>\d\d?(?:[.,]\d+)?)S)?$/i;

/**
 * Parses an ISO 8601 timestamp. If the UTC offset isn't specified, it defaults to +09:00 (JST)
 */
export function parseTimestamp(str: string) {
	const groups = str.trim().replaceAll(";", ":").match(timestampRegex)?.groups;
	if (groups === undefined) {
		throw new SyntaxError(`Malformed date or time: ${str}`);
	}
	return new Date(`\
${groups.year0 ?? groups.year1}-\
${groups.month0 ?? groups.month1}-\
${groups.day0 ?? groups.day1}T\
${groups.hours0 ?? groups.hours1}:\
${groups.minutes0 ?? groups.minutes1}:\
${groups.seconds}\
${groups.utcOffset ?? "+09:00"}`).getTime();
}

export function parseDuration(str: string) {
	const groups = str.trim().match(durationRegex)?.groups;
	if (groups === undefined) {
		throw new SyntaxError(`Malformed duration: ${str}`);
	}
	return ((Number.parseInt(groups.hours ?? "0") * 60 + Number.parseInt(groups.minutes ?? "0")) * 60 + Number.parseFloat(groups.seconds ?? "0")) * 1000;
}
