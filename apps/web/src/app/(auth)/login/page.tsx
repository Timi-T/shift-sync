"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { AxiosError } from "axios";

const schema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

type FormValues = z.infer<typeof schema>;

// Demo credentials — click any row to pre-fill the form
const DEMO_ACCOUNTS = [
  { label: "Admin",              email: "admin@coastaleats.com",       password: "Admin123!",   note: "Full platform access" },
  { label: "Manager (West)",     email: "tom.garcia@coastaleats.com",  password: "Manager123!", note: "Marina + Boardwalk" },
  { label: "Manager (East)",     email: "lisa.chen@coastaleats.com",   password: "Manager123!", note: "Heights + Garden" },
  { label: "Staff – Sarah",      email: "sarah.chen@coastaleats.com",  password: "Staff123!",   note: "Server · Marina" },
  { label: "Staff – Ryan",       email: "ryan.wilson@coastaleats.com", password: "Staff123!",   note: "Cook · near OT" },
  { label: "Staff – Chris",      email: "chris.lee@coastaleats.com",   password: "Staff123!",   note: "Cross-timezone" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormValues) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      toast({
        variant: "destructive",
        title: "Sign in failed",
        description: axiosErr.response?.data?.error ?? "Invalid email or password.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-4">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <ShieldCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">ShiftSync</h1>
          <p className="text-sm text-muted-foreground">Coastal Eats Restaurant Group</p>
        </div>

        {/* Login card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Enter your credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@coastaleats.com"
                  {...register("email")}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...register("password")}
                />
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</> : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo accounts */}
        <Card className="bg-blue-50/50 border-blue-200">
          <CardContent className="py-3 px-4">
            <p className="text-xs font-semibold text-blue-800 mb-2">Demo accounts</p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className="w-full text-left rounded border border-blue-200 bg-white px-3 py-1.5 text-xs hover:bg-blue-50 transition-colors"
                  onClick={() => { setValue("email", a.email); setValue("password", a.password); }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-blue-700">{a.label}</span>
                    <span className="text-[10px] text-muted-foreground">{a.note}</span>
                  </div>
                  <span className="text-muted-foreground">{a.email}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-blue-600">Click an account to pre-fill, then press Sign in.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
