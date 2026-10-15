import type { ApprovalAudience } from "~/utils/approvalBasis";
import type { QueryBasis } from "~/utils/deltaQuery";
import { getUserFromSession } from "~/utils/session";
import { hasPermission } from "~/utils/auth";

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

/**
 * The audience for a requested basis (AB-01, PD-05). The provisional basis is
 * for signed-in reviewers with ValidateData in the session tenant only; a
 * public or unauthorised request for it is refused with 403, never silently
 * downgraded, so a figure is never labelled with a basis it was not built on.
 */
export async function approvalAudienceForBasis(
	request: Request,
	basis: QueryBasis,
): Promise<ApprovalAudience> {
	const audience = await approvalAudienceFromRequest(request);
	if (basis !== "provisional") return audience;
	if (
		audience !== "signed-in" ||
		!(await hasPermission(request, "ValidateData"))
	) {
		throw new Response(
			"The provisional basis is for reviewers with the ValidateData permission",
			{ status: 403 },
		);
	}
	return "reviewer-provisional";
}
