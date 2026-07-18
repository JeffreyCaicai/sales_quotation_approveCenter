import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

import { proxy } from "@/proxy";

describe("admin page authentication shell", () => {
  test.each(["/admin/imports", "/admin/imports/"])(
    "allows the exact import shell %s to render without a session cookie",
    (pathname) => {
      const response = proxy(new NextRequest(`https://tmn.test${pathname}`));

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    },
  );

  test("continues to redirect every other protected admin page", () => {
    const response = proxy(new NextRequest("https://tmn.test/admin/users"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://tmn.test/login?next=%2Fadmin");
  });
});
