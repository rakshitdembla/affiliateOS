import { Card } from "../components/ui/card";

export function ComingSoon({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card className="mt-6">
        <div className="text-sm font-medium">Not built yet — scheduled for Phase {phase}</div>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </Card>
    </div>
  );
}
