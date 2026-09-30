import type { ApprovalAudience } from "~/utils/approvalBasis";
import { getUserFromSession } from "~/utils/session";

/**
 * The approval-basis audience of a request (C23): signed-in when a user
 * session exists and has passed any TOTP step, public otherwise.
 */
export async function approvalAudienceFromRequest(
	request: Request,
): Promise<ApprovalAudience> {
	const userSession = await getUserFromSession(request);
	if (!userSession) return "public";
	const { user, session } = userSession;
	if (user.totpEnabled && !session.totpAuthed) return "public";
	return "signed-in";
}
