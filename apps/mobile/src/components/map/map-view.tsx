/**
 * Mapa natywna (ADR 0040): `@maplibre/maplibre-react-native` z tymi samymi warstwami co wersja web.
 * Wymaga development build (`expo run:ios`); bez Xcode sprawdzają ją tylko typy i lint.
 */
import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '../ui';
import { DEFAULT_ZOOM, MAP_STYLE, mapData, mapLayers, routeOpacity, type MapSourceId, type MapViewProps } from './map-layers';

const SOURCES: MapSourceId[] = ['zones', 'route', 'guide', 'scooters', 'points'];

export function MapView(props: MapViewProps) {
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const data = mapData(props);
  const layers = mapLayers(theme);
  const { focus, padding } = props;

  useEffect(() => {
    if (focus.bounds) camera.current?.fitBounds([...focus.bounds[0], ...focus.bounds[1]], { padding, duration: 600 });
    else if (focus.center) camera.current?.easeTo({ center: focus.center, zoom: focus.zoom ?? DEFAULT_ZOOM, padding, duration: 600 });
    // Widok zmienia się tylko po nowym kluczu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.key]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.map }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={MAP_STYLE[theme.scheme]}
        attribution
        logo={false}
        compass={false}
        onPress={() => props.onPress?.()}
        onRegionDidChange={(e) => {
          if (e.nativeEvent.userInteraction) {
            const [lon, lat] = e.nativeEvent.center;
            props.onCenterChange?.({ lat, lon });
          }
        }}
      >
        <Camera
          ref={camera}
          initialViewState={
            focus.bounds
              ? { bounds: [...focus.bounds[0], ...focus.bounds[1]], padding }
              : { center: focus.center ?? [0, 0], zoom: focus.center ? (focus.zoom ?? DEFAULT_ZOOM) : 1, padding }
          }
        />
        {SOURCES.map((id) => (
          <GeoJSONSource
            key={id}
            id={id}
            data={data[id]}
            onPress={
              id === 'scooters'
                ? (e) => {
                    const scooterId = e.nativeEvent.features[0]?.properties?.id as string | undefined;
                    if (scooterId) props.onScooterPress?.(scooterId);
                  }
                : undefined
            }
          >
            {layers
              .filter((layer) => layer.source === id)
              .map((layer) => {
                // Przyciemniona trasa w pauzie: ta sama warstwa z inną przezroczystością.
                const spec =
                  layer.type === 'line' && layer.id === 'route'
                    ? { ...layer, paint: { ...layer.paint, 'line-opacity': routeOpacity(props.routeMuted) } }
                    : layer;
                return <Layer key={layer.id} {...spec} />;
              })}
          </GeoJSONSource>
        ))}
      </Map>
    </View>
  );
}
