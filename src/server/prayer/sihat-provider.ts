import { PrayerError, type PrayerDay, type PrayerTimeProvider } from "./types";

/**
 * SIHAT (Kemenag RI) adapter stub.
 * The API URL, terms and response format are not verified yet (PRD 14.1 VERIFY),
 * so this class never guesses an endpoint. It fails with a clear error instead.
 */
export class SihatProvider implements PrayerTimeProvider {
  readonly name = "sihat";
  private readonly token: string | undefined;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.token = env.SIHAT_API_TOKEN?.trim() || undefined;
  }

  async fetchMonth(): Promise<PrayerDay[]> {
    if (!this.token) {
      throw new PrayerError(
        "PROVIDER_NOT_CONFIGURED",
        "SIHAT_API_TOKEN is not set. Ask the owner for SIHAT access and set it in the server environment.",
      );
    }
    throw new PrayerError(
      "PROVIDER_NOT_IMPLEMENTED",
      "SIHAT API URL and response format are not verified yet. Implement after the owner confirms the API terms.",
    );
  }
}
