import { z } from "zod";
import { PrayerError } from "./types";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm");

const dayRow = z.strictObject({
  tanggal: z.number().int(),
  tanggal_lengkap: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hari: z.string(),
  imsak: hhmm,
  subuh: hhmm,
  terbit: hhmm,
  dhuha: hhmm,
  dzuhur: hhmm,
  ashar: hhmm,
  maghrib: hhmm,
  isya: hhmm,
});

export const equranMonthSchema = z.strictObject({
  code: z.number(),
  message: z.string(),
  data: z.strictObject({
    provinsi: z.string(),
    kabkota: z.string(),
    bulan: z.number().int(),
    tahun: z.number().int(),
    bulan_nama: z.string(),
    jadwal: z.array(dayRow),
  }),
});

export type EquranMonth = z.infer<typeof equranMonthSchema>;
export type EquranDayRow = z.infer<typeof dayRow>;

export interface EquranRequest {
  provinsi: string;
  kabkota: string;
  bulan: number;
  tahun: number;
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const FAJR_RANGE = [mins("03:30"), mins("05:15")] as const;
const MAGHRIB_RANGE = [mins("17:15"), mins("19:00")] as const;

function reject(reason: string): never {
  throw new PrayerError("PROVIDER_FAILED", `EQuran response rejected: ${reason}`);
}

/**
 * Parses and checks a whole month. Any failure rejects the whole month.
 * Returns the validated body. Throws PrayerError("PROVIDER_FAILED").
 */
export function validateEquranMonth(raw: unknown, req: EquranRequest): EquranMonth {
  const parsed = equranMonthSchema.safeParse(raw);
  if (!parsed.success)
    reject(`schema: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const body = parsed.data;

  if (body.code !== 200) reject(`code ${body.code}`);
  const d = body.data;
  if (d.provinsi !== req.provinsi || d.kabkota !== req.kabkota || d.bulan !== req.bulan || d.tahun !== req.tahun) {
    reject("region or month does not match the request");
  }

  const daysInMonth = new Date(Date.UTC(req.tahun, req.bulan, 0)).getUTCDate();
  if (d.jadwal.length !== daysInMonth) reject(`expected ${daysInMonth} days, got ${d.jadwal.length}`);

  d.jadwal.forEach((row, i) => {
    const dayNo = i + 1;
    const expectedDate = `${req.tahun}-${String(req.bulan).padStart(2, "0")}-${String(dayNo).padStart(2, "0")}`;
    if (row.tanggal !== dayNo || row.tanggal_lengkap !== expectedDate) {
      reject(`day ${dayNo}: date gap or mismatch (${row.tanggal_lengkap})`);
    }
    const order = [row.imsak, row.subuh, row.terbit, row.dzuhur, row.ashar, row.maghrib, row.isya].map(mins);
    for (let k = 1; k < order.length; k++) {
      if ((order[k] as number) <= (order[k - 1] as number)) reject(`day ${dayNo}: prayer times out of order`);
    }
    const fajr = mins(row.subuh);
    const maghrib = mins(row.maghrib);
    if (fajr < FAJR_RANGE[0] || fajr > FAJR_RANGE[1]) reject(`day ${dayNo}: subuh ${row.subuh} out of range`);
    if (maghrib < MAGHRIB_RANGE[0] || maghrib > MAGHRIB_RANGE[1])
      reject(`day ${dayNo}: maghrib ${row.maghrib} out of range`);
  });

  return body;
}
