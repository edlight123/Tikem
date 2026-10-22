import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';

const { width, height } = Dimensions.get('window');

interface SelfieCameraWithGuideProps {
  onCapture: (uri: string) => void;
  onCancel: () => void;
}

export default function SelfieCameraWithGuide({
  onCapture,
  onCancel,
}: SelfieCameraWithGuideProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const cameraRef = useRef<any>(null);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={80} color={colors.primary} />
        <Text style={styles.permissionTitle}>Camera Permission Required</Text>
        <Text style={styles.permissionText}>
          We need access to your camera to take a selfie with your ID
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.9,
          base64: false,
        });
        onCapture(photo.uri);
      } catch (error) {
        console.error('Error taking picture:', error);
        showAlert('Error', 'Failed to take picture');
      }
    }
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing={facing} ref={cameraRef}>
        {/* Facial Guide Overlay */}
        <View style={styles.overlay}>
          {/* Top darkened area */}
          <View style={styles.darkArea} />

          {/* Middle row with oval guide */}
          <View style={styles.middleRow}>
            <View style={styles.darkArea} />

            {/* Oval face guide */}
            <View style={styles.guideContainer}>
              <View style={styles.ovalGuide}>
                {/* Horizontal center line */}
                <View style={styles.horizontalLine} />
                {/* Vertical center line */}
                <View style={styles.verticalLine} />
              </View>
            </View>

            <View style={styles.darkArea} />
          </View>

          {/* Bottom darkened area */}
          <View style={styles.darkArea} />
        </View>

        {/* Instructions at top */}
        <View style={styles.topInstructions}>
          <View style={styles.instructionBadge}>
            <Text style={styles.instructionText}>
              Center your face in the oval
            </Text>
          </View>
          <View style={styles.instructionBadge}>
            <Text style={styles.instructionText}>Hold ID next to your face</Text>
          </View>
        </View>

        {/* Controls at bottom */}
        <View style={styles.controls}>
          {/* Cancel button */}
          <TouchableOpacity style={styles.controlButton} onPress={onCancel}>
            <Ionicons name="close" size={30} color={colors.white} />
          </TouchableOpacity>

          {/* Capture button */}
          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>

          {/* Flip camera button */}
          <TouchableOpacity style={styles.controlButton} onPress={toggleCameraFacing}>
            <Ionicons name="camera-reverse" size={30} color={colors.white} />
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const OVAL_WIDTH = width * 0.6;
const OVAL_HEIGHT = height * 0.35;

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  darkArea: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    width: '100%',
  },
  middleRow: {
    flexDirection: 'row',
    width: '100%',
  },
  guideContainer: {
    width: OVAL_WIDTH,
    height: OVAL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ovalGuide: {
    width: OVAL_WIDTH,
    height: OVAL_HEIGHT,
    borderRadius: OVAL_WIDTH / 2,
    borderWidth: 3,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  horizontalLine: {
    position: 'absolute',
    width: '70%',
    height: 2,
    backgroundColor: colors.primary,
    opacity: 0.6,
  },
  verticalLine: {
    position: 'absolute',
    width: 2,
    height: '70%',
    backgroundColor: colors.primary,
    opacity: 0.6,
  },
  topInstructions: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 8,
  },
  instructionBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.xl,
  },
  instructionText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: colors.primary,
  },
  captureButtonInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginTop: 24,
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: radius.sm,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 12,
  },
  cancelButtonText: {
    color: colors.primary,
    fontSize: 16,
  },
});
