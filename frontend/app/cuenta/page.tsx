"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState, type FormEvent} from "react";
import {api, useResource} from "@/lib/api";
import {OWNER_EMAIL, useAuth} from "@/lib/auth-context";
import type {VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader} from "@/components/ui";
import {Disclosure} from "@/components/disclosure";
import {revealSection} from "@/lib/section-navigation";

export default function AccountPage() {
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assignedIds = auth.user?.vehicle_ids || [];
  const fleet = useResource<VehicleSummary[]>("vehicles", !auth.proposal && !!auth.user && assignedIds.length > 0);
  const assignedVehicles = (fleet.data || []).filter(vehicle => assignedIds.includes(vehicle.id));
  useEffect(() => {if (auth.user) revealSection(window.location.href);}, [auth.user?.id]);
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError(null);
    try {
      if (fields.get("new_password") !== fields.get("confirm_password")) throw new Error("Las contraseñas nuevas no coinciden.");
      await api("auth/password", {method: "POST", body: {current_password: fields.get("current_password"), new_password: fields.get("new_password")}});
      form.reset();
      await auth.refresh();
      router.replace("/acceso?actualizada=1");
    } catch (reason) {setError(reason instanceof Error ? reason.message : "No se pudo cambiar la contraseña.");}
    finally {setBusy(false);}
  }
  if (!auth.proposal && !auth.user) return null;
  return <><PageHeader eyebrow="" title="Mi cuenta" description=""/><section id="perfil" tabIndex={-1} className="panel account-section"><dl className="account-profile-fields"><div><dt>Nombre de usuario</dt><dd>{auth.proposal ? "Administrador de propuesta" : auth.user!.name}</dd></div><div><dt>Correo electrónico</dt><dd>{auth.proposal ? OWNER_EMAIL : auth.user!.email}</dd></div></dl><span className="badge neutral">{auth.proposal ? "Propuesta" : auth.isAdmin ? "Administrador" : "Conductor"}</span></section>
    {auth.isAdmin && <section className="panel account-section"><h2>Usuarios</h2><div className="account-actions"><Link href="/usuarios" className="button secondary">Administrar usuarios<Icon name="arrow" size={17}/></Link></div></section>}
    <section id="unidades-asignadas" tabIndex={-1} className="panel account-section"><h2>Unidades asignadas</h2>{auth.proposal ? <p className="account-hint">No aplica en propuesta</p> : assignedIds.length === 0 ? <Empty title="Sin unidades asignadas"/> : fleet.error ? <ErrorBox message={fleet.error} retry={fleet.refresh}/> : fleet.loading && !fleet.data ? <Loading label="Consultando unidades asignadas…"/> : <ul className="account-assigned-units">{assignedVehicles.map(vehicle => <li key={vehicle.id}><Link href={`/vehiculos/${vehicle.id}`}><span><strong>{vehicle.plate}</strong>{vehicle.nickname && <span>{vehicle.nickname}</span>}<span>{vehicle.make} {vehicle.model}</span></span><Icon name="arrow" size={18}/></Link></li>)}</ul>}</section>
    {auth.proposal ? <section className="panel account-section"><button type="button" className="button secondary" disabled>Cambiar contraseña</button><p className="account-hint">Disponible en el sistema de la empresa.</p></section> : <Disclosure id="cambiar-contrasena" title="Cambiar contraseña"><div className="panel-body account-form"><form onSubmit={changePassword}><fieldset disabled={busy}><label>Escribe tu contraseña actual<input name="current_password" type="password" autoComplete="current-password" required maxLength={128}/></label><label>Nueva contraseña<input name="new_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label><label>Confirmar nueva contraseña<input name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label><span className="field-help">Mínimo 12 caracteres.</span><button type="submit" className="button primary">{busy ? "Guardando…" : "Guardar nueva contraseña"}</button></fieldset></form>{error && <ErrorBox message={error}/>}</div></Disclosure>}
  </>;
}
