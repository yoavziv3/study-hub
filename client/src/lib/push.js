// Phone notifications on the cloud site: this device's Web Push subscription (the cloud decides what to send).
import { api } from '../api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone / iPad only deliver web notifications to a site added to the home screen. */
export const needsInstall = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);

const toBytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4)), (c) => c.charCodeAt(0));

const registration = () => navigator.serviceWorker.ready;

export async function currentSubscription() {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

export async function enablePush() {
  const { key } = await api.get('/api/push/key');
  if (!key) throw new Error('התראות לטלפון עוד לא הוגדרו בשרת');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('ההתראות חסומות – אפשר לאשר אותן בהגדרות הדפדפן של האתר');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different key (keys were replaced) can't be used – start over.
  const own = sub && sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() === toBytes(key).join();
  if (sub && !own) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/** On each visit: tell the cloud about this device's subscription again (it may have been renewed or restored). */
export async function resyncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (sub) await api.post('/api/push/subscribe', { subscription: sub.toJSON() }).catch(() => {});
}
