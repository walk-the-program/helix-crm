/**
 * Screen 3: get something in it.
 *
 * Four ways in, each one card, each card a button. No primary block on this
 * screen, on purpose: the four choices are equal, and painting one of them the
 * primary would be the product telling the owner which business he is running
 * (docs/DESIGN.md §5 allows one primary block per view and zero is a legitimate
 * number).
 *
 * Whichever he picks, setup is already finished by the time he lands — the
 * caller writes `onboarding.completedAt` before it navigates.
 */
import { Card } from "@/ui";
import { ArrowRight } from "@/ui/icons";

export type CustomersChoice = "import" | "site" | "sample" | "empty";

const CHOICES: { id: CustomersChoice; title: string; body: string }[] = [
  {
    id: "import",
    title: "Import a spreadsheet",
    body: "A CSV out of QuickBooks, Jobber, HubSpot or a spreadsheet you keep by hand.",
  },
  {
    id: "site",
    title: "Connect your website",
    body: "Every form fill lands here as a new lead, within a minute, by itself.",
  },
  {
    id: "sample",
    title: "Show me an example",
    body: "A week of made-up customers so you can see how it works. Removable in one click.",
  },
  {
    id: "empty",
    title: "Start empty",
    body: "Add your first customer yourself. This is the right answer more often than it sounds.",
  },
];

export function CustomersScreen({
  onChoose,
  busy,
  busyChoice,
}: {
  onChoose: (choice: CustomersChoice) => void;
  busy?: boolean;
  busyChoice?: CustomersChoice | null;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-[var(--space-1)]">
        <h1>Bring your customers in</h1>
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Pick one. You can do the other three whenever you like.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-[var(--space-4)]">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={busy}
            onClick={() => onChoose(choice.id)}
            className={[
              "text-left disabled:opacity-50 disabled:cursor-not-allowed",
              "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]",
              "focus-visible:outline-offset-1",
            ].join(" ")}
          >
            <Card
              className={[
                "flex h-full flex-col gap-[var(--space-2)] p-[var(--space-4)]",
                "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                "motion-reduce:transition-none hover:bg-[var(--color-hover)]",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-[var(--space-2)]">
                <h3>{choice.title}</h3>
                <ArrowRight
                  size={18}
                  className="flex-none translate-y-[2px] text-[var(--color-text-faint)]"
                  aria-hidden
                />
              </div>
              <p className="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
                {busyChoice === choice.id ? "Setting it up…" : choice.body}
              </p>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
