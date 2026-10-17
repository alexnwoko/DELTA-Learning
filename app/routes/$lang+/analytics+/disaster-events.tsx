// /:lang/analytics/disaster-events moved to the Analysis dashboard (Alex,
// 2026-10-17): a permanent redirect that keeps the link's filters.
import { legacyAnalyticsLoader } from "~/frontend/analytics/dashboard/legacyRedirect";

export const loader = legacyAnalyticsLoader("disaster-events");
