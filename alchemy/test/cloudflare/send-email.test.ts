import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { extractCloudflareResult } from "../../src/cloudflare/api-response.ts";
import { createCloudflareApi, Worker } from "../../src/cloudflare/index.ts";
import { destroy } from "../../src/destroy.ts";
import "../../src/test/vitest.ts";
import { withExponentialBackoff } from "../../src/util/retry.ts";
import { BRANCH_PREFIX } from "../util.ts";

const test = alchemy.test(import.meta, { prefix: BRANCH_PREFIX });
const apiPromise = createCloudflareApi();

describe("Worker send email", () => {
  const testId = `${BRANCH_PREFIX}-send-email`;

  test("basic send email configuration", async (scope) => {
    try {
      const worker = await Worker(`${testId}-basic`, {
        name: `${testId}-basic`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        sendEmail: [{ name: "EMAIL" }],
        adopt: true,
      });

      expect(worker.sendEmail).toEqual([{ name: "EMAIL" }]);

      const workerSettings = await getWorker(worker.name);
      expect(workerSettings.send_email).toMatchObject([{ name: "EMAIL" }]);
    } finally {
      await destroy(scope);
    }
  });

  test("restricted destination address", async (scope) => {
    try {
      const worker = await Worker(`${testId}-restricted`, {
        name: `${testId}-restricted`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        sendEmail: [
          {
            name: "EMAIL",
            destinationAddress: "[email protected]",
          },
        ],
        adopt: true,
      });

      const workerSettings = await getWorker(worker.name);
      expect(workerSettings.send_email).toMatchObject([
        {
          name: "EMAIL",
          destination_address: "[email protected]",
        },
      ]);
    } finally {
      await destroy(scope);
    }
  });

  test("allowed addresses", async (scope) => {
    try {
      const worker = await Worker(`${testId}-allowlist`, {
        name: `${testId}-allowlist`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        sendEmail: [
          {
            name: "EMAIL",
            allowedDestinationAddresses: [
              "[email protected]",
              "[email protected]",
            ],
            allowedSenderAddresses: ["[email protected]"],
          },
        ],
        adopt: true,
      });

      const workerSettings = await getWorker(worker.name);
      expect(workerSettings.send_email).toMatchObject([
        {
          name: "EMAIL",
          allowed_destination_addresses: [
            "[email protected]",
            "[email protected]",
          ],
          allowed_sender_addresses: ["[email protected]"],
        },
      ]);
    } finally {
      await destroy(scope);
    }
  });

  test("update send email configuration", async (scope) => {
    try {
      // Create with basic config
      let worker = await Worker(`${testId}-update`, {
        name: `${testId}-update`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        sendEmail: [{ name: "EMAIL" }],
        adopt: true,
      });

      expect(worker.sendEmail).toEqual([{ name: "EMAIL" }]);

      // Update to add restrictions
      worker = await Worker(`${testId}-update`, {
        name: `${testId}-update`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        sendEmail: [
          {
            name: "EMAIL",
            allowedSenderAddresses: ["[email protected]"],
          },
        ],
        adopt: true,
      });

      const workerSettings = await getWorker(worker.name);
      expect(workerSettings.send_email).toMatchObject([
        {
          name: "EMAIL",
          allowed_sender_addresses: ["[email protected]"],
        },
      ]);
    } finally {
      await destroy(scope);
    }
  });

  test("remove send email configuration", async (scope) => {
    try {
      // Create with send email
      let worker = await Worker(`${testId}-remove`, {
        name: `${testId}-remove`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        sendEmail: [{ name: "EMAIL" }],
        adopt: true,
      });

      expect(worker.sendEmail).toEqual([{ name: "EMAIL" }]);

      // Remove send email
      worker = await Worker(`${testId}-remove`, {
        name: `${testId}-remove`,
        entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
        adopt: true,
      });

      expect(worker.sendEmail).toBeUndefined();

      const workerSettings = await getWorker(worker.name);
      expect(workerSettings.send_email).toBeUndefined();
    } finally {
      await destroy(scope);
    }
  });

  test("validation: mutual exclusivity", async (scope) => {
    try {
      await expect(async () => {
        await Worker(`${testId}-invalid`, {
          name: `${testId}-invalid`,
          entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
          sendEmail: [
            // @ts-expect-error - TypeScript now prevents this invalid combination at compile time
            {
              name: "EMAIL",
              destinationAddress: "[email protected]",
              allowedDestinationAddresses: ["[email protected]"],
            },
          ],
          adopt: true,
        });
      }).rejects.toThrow(
        'Send Email config "EMAIL": cannot specify both destinationAddress and allowedDestinationAddresses',
      );
    } finally {
      await destroy(scope);
    }
  });

  test("validation: invalid email format", async (scope) => {
    try {
      await expect(async () => {
        await Worker(`${testId}-invalid-email`, {
          name: `${testId}-invalid-email`,
          entrypoint: `${__dirname}/test-handlers/basic-fetch.ts`,
          sendEmail: [
            {
              name: "EMAIL",
              destinationAddress: "invalid-email",
            },
          ],
          adopt: true,
        });
      }).rejects.toThrow("Invalid email address: invalid-email");
    } finally {
      await destroy(scope);
    }
  });
});

async function getWorker(name: string) {
  const api = await apiPromise;
  return withExponentialBackoff(
    async () => {
      return await extractCloudflareResult<{
        id: string;
        send_email?: Array<{
          name: string;
          destination_address?: string;
          allowed_destination_addresses?: string[];
          allowed_sender_addresses?: string[];
        }>;
      }>(
        `get worker "${name}"`,
        api.get(`/accounts/${api.accountId}/workers/workers/${name}`),
      );
    },
    () => true,
  );
}
