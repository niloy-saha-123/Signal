// Thin server shell around OnboardingForm. Middleware gates auth before this route.
import { OnboardingForm } from "./onboarding-form";

export default function Page() {
  return <OnboardingForm />;
}
