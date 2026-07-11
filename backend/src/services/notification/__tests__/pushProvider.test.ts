import { postForm, postJson } from "../../../utils/httpClient";

jest.mock("../../../utils/httpClient", () => ({
  postForm: jest.fn(),
  postJson: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "signed-jwt-assertion"),
}));

jest.mock("../../../config", () => ({
  config: {
    push: { projectId: "", clientEmail: "", privateKey: "" },
  },
}));

import { config } from "../../../config";
import { isPushConfigured, sendPush, sendPushToMany } from "../pushProvider";

describe("pushProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).push = { projectId: "", clientEmail: "", privateKey: "" };
  });

  describe("isPushConfigured", () => {
    it("returns false when any of the three FCM fields is missing", () => {
      expect(isPushConfigured()).toBe(false);
      (config as any).push.projectId = "proj-1";
      expect(isPushConfigured()).toBe(false);
    });

    it("returns true when all three FCM fields are set", () => {
      (config as any).push = { projectId: "proj-1", clientEmail: "sa@proj.iam.gserviceaccount.com", privateKey: "key" };
      expect(isPushConfigured()).toBe(true);
    });
  });

  describe("sendPush", () => {
    it("throws when push is not configured", async () => {
      await expect(sendPush({ token: "tok-1", title: "Hi", body: "Body" })).rejects.toThrow(/not configured/);
    });

    it("mints an OAuth token then calls the FCM v1 send endpoint", async () => {
      (config as any).push = { projectId: "proj-1", clientEmail: "sa@proj.iam.gserviceaccount.com", privateKey: "key" };
      (postForm as jest.Mock).mockResolvedValue({ access_token: "access-tok", expires_in: 3600 });
      (postJson as jest.Mock).mockResolvedValue({ name: "projects/proj-1/messages/1" });

      await sendPush({ token: "device-tok", title: "Fee Due", body: "Rs 500 pending" });

      expect(postForm).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" })
      );
      expect(postJson).toHaveBeenCalledWith(
        "https://fcm.googleapis.com/v1/projects/proj-1/messages:send",
        expect.objectContaining({
          message: expect.objectContaining({
            token: "device-tok",
            notification: { title: "Fee Due", body: "Rs 500 pending" },
          }),
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer access-tok" } })
      );
    });

    it("reuses a cached access token across calls within its expiry window", async () => {
      (config as any).push = { projectId: "proj-1", clientEmail: "sa@proj.iam.gserviceaccount.com", privateKey: "key" };
      (postForm as jest.Mock).mockResolvedValue({ access_token: "access-tok", expires_in: 3600 });
      (postJson as jest.Mock).mockResolvedValue({});

      await sendPush({ token: "device-tok-1", title: "A", body: "B" });
      await sendPush({ token: "device-tok-2", title: "A", body: "B" });

      // Token endpoint should only be hit once - the second send reuses
      // the cached token since it's well within its 1hr expiry.
      expect(postForm).toHaveBeenCalledTimes(1);
      expect(postJson).toHaveBeenCalledTimes(2);
    });
  });

  describe("sendPushToMany", () => {
    it("sends to every token and reports failures without throwing", async () => {
      (config as any).push = { projectId: "proj-1", clientEmail: "sa@proj.iam.gserviceaccount.com", privateKey: "key" };
      (postForm as jest.Mock).mockResolvedValue({ access_token: "access-tok", expires_in: 3600 });
      (postJson as jest.Mock)
        .mockResolvedValueOnce({}) // token-1 succeeds
        .mockRejectedValueOnce(new Error("NOT_FOUND")); // token-2 fails (uninstalled app)

      const result = await sendPushToMany(["token-1", "token-2"], { title: "Hi", body: "Body" });

      expect(result.sent).toBe(1);
      expect(result.failedTokens).toEqual(["token-2"]);
    });
  });
});
