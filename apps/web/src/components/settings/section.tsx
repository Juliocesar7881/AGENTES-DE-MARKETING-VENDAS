"use client";
import { Save } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsSection({ title, description, children, onSave, pending, dirty = true, footer }: { title: string; description?: ReactNode; children: ReactNode; onSave?: () => void; pending?: boolean; dirty?: boolean; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
      {onSave || footer ? (
        <CardFooter className="justify-end">
          {footer}
          {onSave ? (
            <Button size="sm" variant="primary" loading={pending} disabled={!dirty} onClick={onSave}>
              <Save /> Save
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
