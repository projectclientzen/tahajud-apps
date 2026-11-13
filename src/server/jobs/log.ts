/** One JSON object per line on stdout. No emails, tokens, or push endpoints: ids and counts only. */
export type LogFields = Record<string, unknown>;
export type Logger = (event: string, fields?: LogFields) => void;

export const consoleLogger: Logger = (event, fields = {}) => {
  console.log(JSON.stringify({ scope: "jobs", event, at: new Date().toISOString(), ...fields }));
};

export const silentLogger: Logger = () => undefined;
