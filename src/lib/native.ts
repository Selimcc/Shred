// L'app tourne-t-elle dans la coque iPhone (Capacitor) ? Dans ce cas, Apple Santé est lu directement.
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const nativePlatform = (): string => Capacitor.getPlatform();
