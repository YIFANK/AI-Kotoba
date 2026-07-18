import { getRequestUser, isAdminUser, json } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = getRequestUser(request);
  if (!user) {
    return json({
      authenticated: false,
      signinUrl: "/signin-with-chatgpt?return_to=%2FAI_kotoba_newUI%2FAI-Kotoba.dc.html",
    });
  }
  return json({
    authenticated: true,
    displayName: user.name,
    isAdmin: isAdminUser(user),
    signoutUrl: "/signout-with-chatgpt?return_to=%2FAI_kotoba_newUI%2FAI-Kotoba.dc.html",
  });
}
