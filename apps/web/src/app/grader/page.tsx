import { MonthlyGrader } from "./MonthlyGrader";

export const metadata = {
  title: "Monthly grader · did we ship today?",
  description: "An evidence-led monthly review for building work.",
};

export default function GraderPage() {
  return <MonthlyGrader />;
}
