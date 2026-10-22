"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState, type FormEvent} from "react";
import {api} from "@/lib/api";
import {useAuth} from "@/lib/auth-context";
import {ErrorBox, Icon, PageHeader} from "@/components/ui";
import "./access-presentation.css";

export default function AccessPage() {
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);
  useEffect(() => {setPasswordChanged(new URLSearchParams(window.location.search).get("actualizada") === "1");}, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError(null);
    try {
      await api("auth/login", {method: "POST", body: {email: fields.get("email"), password: fields.get("password")}});
      form.reset();
      await auth.refresh();
      router.replace("/");
    } catch (reason) {setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");}
    finally {setBusy(false);}
  }
  if (auth.proposal) return <section className="panel account-gate"><Icon name="users" size={32}/><h1>Iniciar sesión</h1><p>Este enlace muestra la propuesta con datos ficticios. Las cuentas personales estarán disponibles en el servidor de la empresa.</p><p className="account-hint">No captures contraseñas reales en esta demostración.</p><Link href="/" className="button primary">Explorar la propuesta<Icon name="arrow"/></Link></section>;
  if (auth.user) return <section className="panel account-gate"><h1>Ya tienes una sesión abierta</h1><p>{auth.user.name} · {auth.user.email}</p><div className="account-actions"><Link href="/" className="button primary">Ver mis unidades</Link><Link href="/cuenta" className="button secondary">Mi cuenta</Link></div></section>;
  return <div className="login-page">
    <section className="panel account-section account-form access-card">
      <div className="access-heading">
        <div className="access-label"><span className="access-symbol"><Icon name="users" size={20}/></span><span>Acceso personal</span></div>
        <PageHeader title="Bienvenido a Yokohama"/>
      </div>
      {passwordChanged && <p className="message success" role="status">Contraseña actualizada. Inicia sesión con tu nueva contraseña.</p>}
      <form onSubmit={submit}>
        <fieldset disabled={busy || !auth.configured}>
          <label>Correo electrónico<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
          <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
          <button className="button primary" type="submit">{busy ? "Entrando…" : "Iniciar sesión"}<Icon name="arrow" size={17}/></button>
        </fieldset>
      </form>
      {!auth.configured && <p className="account-hint">Las cuentas aún no están habilitadas. El responsable del sistema debe activar el acceso de la empresa.</p>}
      <p className="account-hint access-support">Si necesitas una cuenta o recuperar el acceso, comunícate con:<br/><a href="mailto:martinmoralesbasurto1@gmail.com">martinmoralesbasurto1@gmail.com</a><br/><a href="mailto:ruben.cicata@gmail.com">ruben.cicata@gmail.com</a>.</p>
      {error && <ErrorBox message={error}/>}
    </section>
  </div>;
}
