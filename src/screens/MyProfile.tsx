// Mon profil : un seul endroit pour qui tu es (photo, prénom, corps), ton sport, ton alimentation et ce que
// le coach doit savoir. En haut, ce que les autres voient de toi : niveau, série, étincelles, fiche de force.
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { type Athlete, ACTIVITIES, sportLabel } from '../../shared/athlete';
import { AvatarCrop } from '../components/AvatarCrop';
import { Field } from '../components/form';
import { IdentityForm } from '../components/IdentityForm';
import { Icon } from '../components/Icon';
import { Radar } from '../components/Radar';
import { RollingNumber } from '../components/RollingNumber';
import { ask, errorText, toast } from '../components/ui';
import { DEMO } from '../lib/api';
import { club } from '../lib/club';
import { setMe, useMe } from '../lib/me';
import { getIdentity, type Identity } from '../lib/identity';
import { applyProgram, applyTargets, lastWeight, programFor } from '../lib/coaching';
import { dayKey, formatNumber } from '../lib/date';
import { flameInfo } from '../lib/flames';
import { levelFor, totalXp } from '../lib/logic';
import { signedIn } from '../lib/session';
import { setState, useApp } from '../lib/store';
import { strengthProfile } from '../lib/strength';
import { BodyForm, DietForm, SportForm } from './AthleteForms';
import { MemberAvatar } from './Club';
import type { SettingsPage } from './Settings';

const LEVELS: Record<Athlete['experience'], string> = { beginner: 'débutant', intermediate: 'intermédiaire', advanced: 'confirmé' };

type Part = 'id' | 'me' | 'sport' | 'food' | 'coach';

function Section({ id, open, onToggle, icon, title, sub, children }: { id: Part; open: boolean; onToggle: (id: Part) => void; icon: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className={`profile-part ${open ? 'open' : ''}`}>
      <button className="row settings-row" onClick={() => onToggle(id)} aria-expanded={open}>
        <span className="settings-icon">
          <Icon name={icon} size={18} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title">{title}</div>
          {!open && <div className="small muted ellipsis">{sub}</div>}
        </div>
        <span className="profile-chevron">
          <Icon name="chevron" size={18} />
        </span>
      </button>
      {open && <div className="profile-body">{children}</div>}
    </div>
  );
}

export function MyProfilePage({ go }: { go: (p: SettingsPage) => void }) {
  const s = useApp();
  const a = s.settings.athlete;
  const today = dayKey();
  const weight = lastWeight(s);
  const [open, setOpen] = useState<Part | null>(null);
  const me = useMe();
  const file = useRef<HTMLInputElement>(null);
  const canPhoto = DEMO || signedIn();
  // Pseudo, surnom et bio n'existent qu'avec un compte (le club n'est pas dans la démo publique).
  const social = !DEMO && signedIn();
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    if (social) getIdentity().then(setIdentity, () => undefined);
  }, [social]);

  const saveAthlete = (x: Athlete) => setState((d) => void (d.settings.athlete = x));
  const toggle = (id: Part) => setOpen((o) => (o === id ? null : id));

  const flames = flameInfo(s, today);
  const level = levelFor(totalXp(s)).level;
  const sparks = s.club?.sparks ?? 0;
  const stats: [number, string][] = [
    [level, 'niveau'],
    [flames.current, 'série'],
    [flames.earned.length, flames.earned.length > 1 ? 'flammes' : 'flamme'],
    [sparks, sparks > 1 ? 'étincelles' : 'étincelle'],
  ];
  const groups = s.settings.modules.strength ? strengthProfile(s, today).groups : [];
  const radar = groups.some((g) => g.score !== null);

  const [crop, setCrop] = useState<File | null>(null);
  const photo = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setCrop(f);
  };
  const upload = async (dataUrl: string) => {
    try {
      const r = await club.avatar(dataUrl);
      if (me) setMe({ ...me, avatar: r.avatar });
      else {
        const mine = (await club.members()).members.find((x) => x.me);
        if (mine) setMe({ id: mine.id, avatar: r.avatar });
      }
      setCrop(null);
      toast('Photo de profil mise à jour');
    } catch (err) {
      toast(errorText(err), true);
    }
  };

  const d = a.diet;
  const food = [
    d.meals === 4 ? '3 repas + collation' : '3 repas',
    d.vegetarian && 'végétarien',
    d.noPork && 'sans porc',
    d.lactoseFree && 'sans lactose',
    d.cook === 'quick' && 'cuisine rapide',
    d.budget === 'tight' && 'petit budget',
  ].filter(Boolean);
  const body = [
    s.settings.age && `${s.settings.age} ans`,
    s.settings.height && `${s.settings.height} cm`,
    weight && `${formatNumber(weight, 1)} kg`,
    a.bodyFat && `${a.bodyFat} % de masse grasse`,
  ].filter(Boolean);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="member-head">
        <button
          className="member-photo"
          onClick={() => canPhoto && file.current?.click()}
          disabled={!canPhoto}
          aria-label={canPhoto ? 'Changer ma photo de profil' : undefined}
        >
          <MemberAvatar m={{ id: me?.id ?? 'me', name: s.settings.name || '?', avatar: me?.avatar ?? null }} size={72} />
          {canPhoto && (
            <span className="member-photo-edit">
              <Icon name="camera" size={14} />
            </span>
          )}
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={photo} />
        {crop && <AvatarCrop file={crop} onCancel={() => setCrop(null)} onDone={upload} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="profile-name">{s.settings.name || 'Ton prénom'}</div>
          {identity?.handle && (
            <div className="small ellipsis">
              <span className="member-handle">@{identity.handle}</span>
              {identity.nick && <span className="member-nick muted">, {identity.nick}</span>}
            </div>
          )}
          <div className="small muted ellipsis">
            {sportLabel(a)}, {LEVELS[a.experience]}
          </div>
        </div>
      </div>
      {identity?.bio && <p className="member-bio small">{identity.bio}</p>}

      <div className="member-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
        {stats.map(([v, label]) => (
          <div key={label}>
            <b className="display num">
              <RollingNumber value={v} />
            </b>
            <span className="small muted">{label}</span>
          </div>
        ))}
      </div>

      <div className="group">
        {social && (
          <Section
            id="id"
            open={open === 'id'}
            onToggle={toggle}
            icon="at"
            title="Nom d’utilisateur, surnom et bio"
            sub={identity ? [`@${identity.handle}`, identity.nick, identity.bio ? 'bio' : 'sans bio'].filter(Boolean).join(', ') : 'Ce que le club voit de toi'}
          >
            <IdentityForm onSaved={setIdentity} />
          </Section>
        )}
        <Section id="me" open={open === 'me'} onToggle={toggle} icon="user" title="Moi" sub={[s.settings.name || 'Prénom à renseigner', ...body].join(', ')}>
          {!social && (
            <Field label="Prénom">
              <input className="input" value={s.settings.name} placeholder="Ton prénom" onChange={(e) => setState((x) => void (x.settings.name = e.target.value.slice(0, 30)))} />
            </Field>
          )}
          <BodyForm
            athlete={a}
            body={{ age: s.settings.age, height: s.settings.height, weight }}
            onAthlete={saveAthlete}
            onBody={(b) =>
              setState((x) => {
                x.settings.age = b.age;
                x.settings.height = b.height;
                if (b.weight && b.weight !== weight) x.body.weight[today] = b.weight;
              })
            }
          />
        </Section>
        <Section
          id="sport"
          open={open === 'sport'}
          onToggle={toggle}
          icon="dumbbell"
          title="Sport et niveau"
          sub={`${sportLabel(a)}, ${LEVELS[a.experience]}, ${a.days} × ${a.minutes} min, ${ACTIVITIES[a.activity].label.toLowerCase()} au quotidien`}
        >
          <SportForm athlete={a} onAthlete={saveAthlete} />
        </Section>
        <Section id="food" open={open === 'food'} onToggle={toggle} icon="utensils" title="Alimentation" sub={food.join(', ')}>
          <DietForm diet={d} onDiet={(diet) => saveAthlete({ ...a, diet })} />
        </Section>
        <Section id="coach" open={open === 'coach'} onToggle={toggle} icon="chat" title="Pour le coach" sub={s.settings.coachNotes.trim() || 'Blessures, contraintes, aliments à éviter…'}>
          <textarea
            className="input"
            rows={5}
            style={{ resize: 'vertical' }}
            placeholder="Objectif, sport à côté, aliments que tu n’aimes pas, budget, blessures…"
            value={s.settings.coachNotes}
            onChange={(e) => setState((x) => void (x.settings.coachNotes = e.target.value.slice(0, 1200)))}
          />
        </Section>
        <button className="row settings-row" onClick={() => go('publicProfile')}>
          <span className="settings-icon">
            <Icon name="users" size={18} />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="title">Ce que le club voit</div>
            <div className="small muted ellipsis">{s.settings.profile.visible ? 'Profil visible par le club' : 'Profil privé'}</div>
          </div>
          <Icon name="chevron" size={18} />
        </button>
      </div>

      {radar && (
        <section className="stack" style={{ gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Ta fiche de force</h2>
          <div className="card" style={{ padding: '8px 8px 4px' }}>
            <Radar groups={groups} />
          </div>
        </section>
      )}

      {(open === 'me' || open === 'sport' || open === 'food') && (
        <section className="stack" style={{ gap: 10 }}>
          <p className="small muted" style={{ margin: 0 }}>
            Tes changements sont enregistrés. Applique-les à tes objectifs et à ton programme quand tu veux :
          </p>
          <button
            className="btn block"
            onClick={() => {
              const plan = applyTargets();
              toast(plan ? `Objectif : ${plan.targets.kcal} kcal, ${plan.targets.protein} g de protéines` : 'Indique ton âge, ta taille et ton poids', !plan);
            }}
          >
            Recalculer mes calories
          </button>
          <button
            className="btn block"
            onClick={async () => {
              const { program, swaps } = programFor(s.settings.athlete, s.settings.gym);
              if (!(await ask(`Remplacer ton programme par « ${program.name} » ?${swaps.length ? ` ${swaps.length} exercice(s) adapté(s) à ta salle.` : ''} Ton historique est conservé.`, 'Remplacer', true))) return;
              applyProgram(program);
              toast(`Programme « ${program.name} » chargé`);
            }}
          >
            Générer le programme de mon profil
          </button>
        </section>
      )}
    </div>
  );
}
