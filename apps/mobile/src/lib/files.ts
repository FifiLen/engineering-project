/**
 * Zdjęcia zgłoszeń i parkowania (ADR 0057): wybór z aparatu albo galerii (`expo-image-picker`; w wersji web
 * wybór pliku), zmniejszenie do 1600 px dłuższego boku i JPEG 0,7 (`expo-image-manipulator`, także HEIC
 * z iPhone'a), wysyłka `POST /files` jako `multipart/form-data`. Zdjęcie czeka w pamięci ekranu, bez kolejki.
 */
import type { FileView, UploadFilePurpose } from '@hulajnogi/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api, API_URL } from './api';

export const PHOTO_MAX_PX = 1600;
export const PHOTO_QUALITY = 0.7;

/** Zdjęcie gotowe do wysyłki: lokalny plik JPEG (na webie adres `blob:` albo `data:`). */
export interface LocalPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Zmniejszenie i konwersja do JPEG przed wysyłką; mniejsze zdjęcie zostaje w swoim rozmiarze. */
export async function preparePhoto(uri: string): Promise<LocalPhoto> {
  const context = ImageManipulator.manipulate(uri);
  let image = await context.renderAsync();
  const longest = Math.max(image.width, image.height);
  if (longest > PHOTO_MAX_PX) {
    context.resize(image.width >= image.height ? { width: PHOTO_MAX_PX } : { height: PHOTO_MAX_PX });
    image = await context.renderAsync();
  }
  const saved = await image.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

export type PickResult = { kind: 'photo'; photo: LocalPhoto } | { kind: 'cancelled' } | { kind: 'denied' };

/**
 * Zdjęcie z aparatu albo z galerii przez systemowy wybór. Odmowa dostępu do aparatu daje `denied`, a ekran
 * proponuje galerię; w wersji web oba źródła otwierają wybór pliku (przeglądarka telefonu może sama
 * zaproponować aparat).
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: 'denied' };
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return { kind: 'cancelled' };
  return { kind: 'photo', photo: await preparePhoto(asset.uri) };
}

/** `POST /files`: plik i cel; typ pliku API rozpoznaje po sygnaturze. */
export function uploadPhoto(photo: LocalPhoto, purpose: UploadFilePurpose): Promise<FileView> {
  return api<FileView>('/files', {
    method: 'POST',
    form: async () => {
      const form = new FormData();
      form.append('purpose', purpose);
      if (Platform.OS === 'web') {
        const blob = await (await fetch(photo.uri)).blob();
        form.append('file', blob, 'photo.jpg');
      } else {
        // React Native wysyła plik z dysku po `uri` (obiekt zamiast `Blob`).
        form.append('file', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
      }
      return form;
    },
  });
}

/** Adres odczytu z widoku (`/files/{id}?exp=…&sig=…`, podpis na 10 min) jako pełny adres API. */
export const fileUrl = (url: string): string => (url.startsWith('/') ? `${API_URL}${url}` : url);
