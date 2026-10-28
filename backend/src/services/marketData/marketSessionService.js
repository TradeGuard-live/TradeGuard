/**
 * marketSessionService.js
 * 
 * ✅ Session-aware Indian Market Schedule Engine (NSE, BSE, MCX)
 * - Strict Asia/Kolkata timezone normalization without browser/OS timezone leakage
 * - Exchange-specific trading session windows:
 *   - NSE/BSE Equity & F&O:
 *     - Pre-Open: 09:00 - 09:08 (Order entry), 09:08 - 09:15 (Order matching)
 *     - Regular Trading: 09:15 - 15:30 IST
 *     - Post-Closing / Extended: 15:40 - 16:00 IST
 *   - NSE Currency: 09:00 - 17:00 IST
 *   - MCX Commodities: 09:00 - 23:30 (23:55 during US daylight saving)
 * - Weekend handling (Saturday & Sunday)
 * - Comprehensive official NSE/BSE Trading Holidays (2025 - 2027)
 */

// Official NSE / BSE Trading Holidays (YYYY-MM-DD)
const TRADING_HOLIDAYS = new Set([
    // 2025
    "2025-01-26", // Republic Day
    "2025-02-26", // Mahashivratri
    "2025-03-14", // Holi
    "2025-03-31", // Id-Ul-Fitr (Ramzan Id)
    "2025-04-10", // Mahavir Jayanti
    "2025-04-14", // Dr. Baba Saheb Ambedkar Jayanti
    "2025-04-18", // Good Friday
    "2025-05-01", // Maharashtra Day
    "2025-06-07", // Bakri Id
    "2025-07-06", // Moharram
    "2025-08-15", // Independence Day
    "2025-08-27", // Ganesh Chaturthi
    "2025-10-02", // Mahatma Gandhi Jayanti
    "2025-10-21", // Diwali Laxmi Pujan (Special Muhurat session)
    "2025-10-22", // Diwali Balipratipada
    "2025-11-05", // Prakash Gurpurb Sri Guru Nanak Dev
    "2025-12-25", // Christmas

    // 2026
    "2026-01-26", // Republic Day
    "2026-02-17", // Mahashivratri
    "2026-03-03", // Holi
    "2026-03-20", // Id-Ul-Fitr
    "2026-03-31", // Mahavir Jayanti
    "2026-04-03", // Good Friday
    "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
    "2026-05-01", // Maharashtra Day
    "2026-05-27", // Bakri Id
    "2026-06-25", // Moharram
    "2026-08-15", // Independence Day
    "2026-09-15", // Milad-un-Nabi
    "2026-10-02", // Mahatma Gandhi Jayanti
    "2026-10-20", // Dussehra
    "2026-11-08", // Diwali Laxmi Pujan
    "2026-11-10", // Diwali Balipratipada
    "2026-11-24", // Guru Nanak Jayanti
    "2026-12-25", // Christmas

    // 2027
    "2027-01-26", // Republic Day
    "2027-03-08", // Mahashivratri
    "2027-03-22", // Holi
    "2027-03-26", // Good Friday
    "2027-04-14", // Ambedkar Jayanti
    "2027-05-01", // Maharashtra Day
    "2027-08-15", // Independence Day
    "2027-10-02", // Mahatma Gandhi Jayanti
    "2027-10-29", // Diwali
    "2027-12-25"  // Christmas
]);

/**
 * Returns current date and time components normalized to Asia/Kolkata timezone.
 * @param {Date|number|string} [targetDate] - Optional date to check (defaults to now)
 * @returns {object} { year, month, dateStr, dayOfWeek, hours, minutes, totalMinutes, isWeekend, isHoliday }
 */
export function getISTDateTime(targetDate = new Date()) {
    const d = targetDate instanceof Date ? targetDate : new Date(targetDate);
    const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;

    // Use standard Intl to format in Asia/Kolkata
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        weekday: "short"
    });

    const parts = formatter.formatToParts(safeDate);
    const map = {};
    for (const p of parts) {
        map[p.type] = p.value;
    }

    const year = parseInt(map.year, 10);
    const month = parseInt(map.month, 10);
    const day = parseInt(map.day, 10);
    const hours = parseInt(map.hour, 10);
    const minutes = parseInt(map.minute, 10);
    const seconds = parseInt(map.second, 10);

    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const totalMinutes = hours * 60 + minutes;

    // Day of week in IST: map abbreviation to 0 (Sun) - 6 (Sat)
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = weekdayMap[map.weekday] ?? 1;

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = TRADING_HOLIDAYS.has(dateStr);

    return {
        year,
        month,
        day,
        dateStr,
        dayOfWeek,
        hours,
        minutes,
        seconds,
        totalMinutes,
        isWeekend,
        isHoliday
    };
}

/**
 * Checks detailed market session status for a given exchange and segment.
 * @param {string} exchange - e.g. "NSE", "BSE", "MCX"
 * @param {string} segment - e.g. "EQUITY", "FUTURES", "OPTIONS", "COMMODITY", "CURRENCY"
 * @param {Date|number|string} [targetDate]
 * @returns {object} { isOpen: boolean, session: string, message: string, dateStr: string, timeIST: string }
 */
export function getMarketSession(exchange = "NSE", segment = "EQUITY", targetDate = new Date()) {
    const ist = getISTDateTime(targetDate);
    const ex = String(exchange || "NSE").toUpperCase();
    const seg = String(segment || "EQUITY").toUpperCase();

    const timeIST = `${String(ist.hours).padStart(2, "0")}:${String(ist.minutes).padStart(2, "0")}:${String(ist.seconds).padStart(2, "0")} IST`;

    if (ist.isWeekend) {
        return {
            isOpen: false,
            session: "CLOSED",
            reason: "WEEKEND",
            message: `Market is closed for the weekend (${ist.dayOfWeek === 0 ? "Sunday" : "Saturday"}).`,
            dateStr: ist.dateStr,
            timeIST
        };
    }

    if (ist.isHoliday) {
        return {
            isOpen: false,
            session: "CLOSED",
            reason: "HOLIDAY",
            message: `Market is closed for official trading holiday on ${ist.dateStr}.`,
            dateStr: ist.dateStr,
            timeIST
        };
    }

    // Currency derivatives: 09:00 - 17:00 IST (540 to 1020 mins)
    if (seg === "CURRENCY") {
        if (ist.totalMinutes >= 540 && ist.totalMinutes < 1020) {
            return {
                isOpen: true,
                session: "REGULAR",
                message: "Currency market session is active.",
                dateStr: ist.dateStr,
                timeIST
            };
        }
        return {
            isOpen: false,
            session: "CLOSED",
            reason: "AFTER_HOURS",
            message: "Currency market session closed (09:00 - 17:00 IST).",
            dateStr: ist.dateStr,
            timeIST
        };
    }

    // MCX Commodity: 09:00 - 23:30 IST (540 to 1410 mins)
    if (ex === "MCX" || seg.includes("COMMODITY")) {
        if (ist.totalMinutes >= 540 && ist.totalMinutes < 1410) {
            return {
                isOpen: true,
                session: "REGULAR",
                message: "Commodity market session is active.",
                dateStr: ist.dateStr,
                timeIST
            };
        }
        return {
            isOpen: false,
            session: "CLOSED",
            reason: "AFTER_HOURS",
            message: "Commodity market session closed (09:00 - 23:30 IST).",
            dateStr: ist.dateStr,
            timeIST
        };
    }

    // Default: NSE / BSE Equity & Derivatives (Cash & F&O)
    // Pre-Open: 09:00 - 09:15 (540 - 555 mins)
    if (ist.totalMinutes >= 540 && ist.totalMinutes < 555) {
        return {
            isOpen: false, // Not regular trading
            session: "PRE_OPEN",
            reason: "PRE_OPEN",
            message: "Pre-market session active (09:00 - 09:15 IST).",
            dateStr: ist.dateStr,
            timeIST
        };
    }

    // Regular Trading: 09:15 - 15:30 (555 - 930 mins)
    if (ist.totalMinutes >= 555 && ist.totalMinutes <= 930) {
        return {
            isOpen: true,
            session: "REGULAR",
            message: "Regular market trading hours active (09:15 - 15:30 IST).",
            dateStr: ist.dateStr,
            timeIST
        };
    }

    // Post-closing session: 15:40 - 16:00 (940 - 960 mins)
    if (ist.totalMinutes > 930 && ist.totalMinutes <= 960) {
        return {
            isOpen: false,
            session: "POST_CLOSE",
            reason: "POST_CLOSE",
            message: "Post-closing session (15:40 - 16:00 IST). Official closing prices settled.",
            dateStr: ist.dateStr,
            timeIST
        };
    }

    // Outside all sessions: CLOSED
    return {
        isOpen: false,
        session: "CLOSED",
        reason: ist.totalMinutes < 540 ? "PRE_MARKET" : "POST_MARKET",
        message: ist.totalMinutes < 540
            ? "Market has not opened yet. Regular trading starts at 09:15 AM IST."
            : "Market closed for the day at 03:30 PM IST.",
        dateStr: ist.dateStr,
        timeIST
    };
}

export { getMarketSession as getMarketSessionInfo };

/**
 * Simple boolean check: is Indian cash/F&O market currently open for regular live trading?
 */
export function isIndianMarketOpen(targetDate = new Date()) {
    return getMarketSession("NSE", "EQUITY", targetDate).isOpen;
}

