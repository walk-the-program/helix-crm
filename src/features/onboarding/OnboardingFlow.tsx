/**
 * The three screens, and the order they happen in.
 *
 * Screen 1 saves the business. Screen 2 writes the pipeline, the sources, the
 * fields, the vocabulary and `onboarding.completedAt` in one transaction.
 * Screen 3 gets something into the workspace and leaves. "Skip for now" is on
 * every screen and writes `onboarding.skippedAt`, so nothing here is a trap.
 *
 * With the defaults it is: read, Continue, Use this setup, Start empty. Four
 * clicks, well under a minute, and the owner has a pipeline in his own words.
 *
 * Two mounts, one component. The gate renders it as the whole window before the
 * shell exists; the "/setup" route renders it inside the shell, which is why
 * `chrome` is a prop rather than an assumption.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { Spinner, toast } from "@/ui";
import { OnboardingFrame } from "@/features/onboarding/components/frame";
import {
  BusinessScreen,
  businessDraftProblems,
  type BusinessDraft,
} from "@/features/onboarding/screens/BusinessScreen";
import { TrackingScreen } from "@/features/onboarding/screens/TrackingScreen";
import {
  CustomersScreen,
  type CustomersChoice,
} from "@/features/onboarding/screens/CustomersScreen";
import {
  applyPlan,
  planFromPreset,
  type SetupPlan,
} from "@/features/onboarding/lib/applyPreset";
import { loadSampleData } from "@/features/onboarding/lib/sampleData";
import {
  markCompleted,
  markSkipped,
  readBusinessProfile,
  readDefaultBusinessName,
  writeBusinessProfile,
} from "@/features/onboarding/lib/settings";
import { asTradeId, presetFor } from "@/features/onboarding/presets";
import type { TradeId } from "@/features/onboarding/presets/types";

type Step = 1 | 2 | 3;

const EMPTY_DRAFT: BusinessDraft = {
  businessName: "",
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  trade: null,
  tradeOther: "",
};

export function OnboardingFlow({
  chrome = true,
  onFinish,
}: {
  chrome?: boolean;
  /** Leave setup: the gate swaps in the shell, the route navigates away. */
  onFinish: () => void;
}) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<BusinessDraft>(EMPTY_DRAFT);
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyChoice, setBusyChoice] = useState<CustomersChoice | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  /* The gate mounts this outside the shell, so there is no Toaster under it.
   * Anything the owner has to read goes on the screen as well. */
  const [flowError, setFlowError] = useState<string | null>(null);
  const loaded = useRef(false);

  /* Prefill. Reopening setup should show what was said last time, not a blank. */
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const [profile, defaultName] = await Promise.all([
          readBusinessProfile(),
          readDefaultBusinessName(),
        ]);
        setDraft({
          businessName: profile.businessName || defaultName,
          ownerName: profile.ownerName,
          ownerEmail: profile.ownerEmail,
          ownerPhone: profile.ownerPhone,
          trade: asTradeId(profile.trade),
          tradeOther: profile.tradeOther,
        });
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const trade: TradeId = draft.trade ?? "other";
  const preset = presetFor(trade);

  const skip = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        await markSkipped();
      } catch (err) {
        console.error("[helix] could not record the skip", err);
      }
      await queryClient.invalidateQueries();
      navigate("/");
      onFinish();
    })();
  }, [onFinish, queryClient]);

  const continueFromBusiness = useCallback(() => {
    setFlowError(null);
    setShowProblems(true);
    if (Object.keys(businessDraftProblems(draft)).length > 0) return;
    setBusy(true);
    void (async () => {
      try {
        await writeBusinessProfile({
          businessName: draft.businessName.trim(),
          trade: draft.trade,
          tradeOther: draft.tradeOther.trim(),
          ownerName: draft.ownerName.trim(),
          ownerEmail: draft.ownerEmail.trim(),
          ownerPhone: draft.ownerPhone.trim(),
        });
        setPlan(planFromPreset(presetFor(draft.trade ?? "other")));
        setStep(2);
        setShowProblems(false);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Those details did not save. Try again.";
        setFlowError(message);
        toast.error(message);
      } finally {
        setBusy(false);
      }
    })();
  }, [draft]);

  const apply = useCallback(() => {
    if (!plan) return;
    setBusy(true);
    setApplyError(null);
    void (async () => {
      try {
        const result = await applyPlan(plan);
        await queryClient.invalidateQueries();
        // Stages holding work are never thrown away, so say which ones stayed
        // rather than letting the owner find two pipelines' worth of stages on
        // the board and wonder which of them he asked for.
        if (result.stagesKept.length > 0) {
          const kept = result.stagesKept.join(", ");
          toast.success(
            `Set up. ${kept} ${result.stagesKept.length === 1 ? "was" : "were"} kept: ${
              result.stagesKept.length === 1 ? "it still holds" : "they still hold"
            } work.`,
          );
        }
        setStep(3);
      } catch (err) {
        setApplyError(
          err instanceof Error ? err.message : "That setup did not save. Nothing changed.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [plan, queryClient]);

  const choose = useCallback(
    (choice: CustomersChoice) => {
      setBusy(true);
      setBusyChoice(choice);
      void (async () => {
        try {
          await markCompleted();
          if (choice === "sample") {
            const counts = await loadSampleData(trade);
            toast.success(
              `Loaded ${counts.contacts} example customers. Remove them whenever you like.`,
            );
          }
          await queryClient.invalidateQueries();
          navigate(
            choice === "import" ? "/import" : choice === "site" ? "/settings/site" : "/",
          );
          onFinish();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Setup did not finish. Nothing changed.";
          setFlowError(message);
          toast.error(message);
          setBusy(false);
          setBusyChoice(null);
        }
      })();
    },
    [onFinish, queryClient, trade],
  );

  if (!ready) {
    return (
      <OnboardingFrame step={1} chrome={chrome} onSkip={skip} busy>
        <div className="flex items-center gap-[var(--space-3)] py-[var(--space-8)]">
          <Spinner />
          <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Opening setup…
          </span>
        </div>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame step={step} chrome={chrome} onSkip={skip} busy={busy}>
      {step === 1 ? (
        <BusinessScreen
          draft={draft}
          onChange={setDraft}
          onContinue={continueFromBusiness}
          busy={busy}
          showProblems={showProblems}
        />
      ) : null}
      {step === 2 && plan ? (
        <TrackingScreen
          preset={preset}
          plan={plan}
          onChange={setPlan}
          onApply={apply}
          onBack={() => setStep(1)}
          busy={busy}
          error={applyError}
        />
      ) : null}
      {step === 3 ? (
        <CustomersScreen onChoose={choose} busy={busy} busyChoice={busyChoice} />
      ) : null}
      {flowError ? (
        <p role="alert" className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
          {flowError}
        </p>
      ) : null}
    </OnboardingFrame>
  );
}

/**
 * The "/setup" route. Same three screens inside the shell, and "finishing" here
 * means going back to Today rather than swapping the whole window.
 */
export function SetupScreen() {
  // Every exit from the flow navigates for itself, so there is nothing left to
  // do here: the route just stops being the thing on screen.
  return <OnboardingFlow chrome={false} onFinish={() => undefined} />;
}
