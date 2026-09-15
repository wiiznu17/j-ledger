import { Injectable, Logger } from '@nestjs/common';
import {
  RekognitionClient,
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from '@aws-sdk/client-rekognition';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AwsRekognitionService {
  private readonly client: RekognitionClient | null = null;
  private readonly isMock: boolean;
  private readonly logger = new Logger(AwsRekognitionService.name);

  constructor(private readonly configService: ConfigService) {
    const provider = this.configService.get<string>('KYC_FACE_PROVIDER_TYPE');
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const hasAwsKeys = !!accessKeyId && !!secretAccessKey && accessKeyId !== 'mock_local_access_key';

    this.isMock = provider === 'mock' || (!isProduction && provider !== 'aws') || !hasAwsKeys;

    if (this.isMock) {
      this.logger.log('AwsRekognitionService initialized in MOCK mode (bypassing AWS Rekognition)');
    } else {
      this.logger.log('AwsRekognitionService initialized in AWS Rekognition mode');
      this.client = new RekognitionClient({
        region: this.configService.get('AWS_REGION') || 'ap-southeast-1',
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
      });
    }
  }

  async createLivenessSession(): Promise<string> {
    if (this.isMock) {
      const mockSessionId = `mock-liveness-${Date.now()}`;
      this.logger.debug(`[MOCK REKOGNITION] Created mock liveness session: ${mockSessionId}`);
      return mockSessionId;
    }

    try {
      const command = new CreateFaceLivenessSessionCommand({});
      const response = await this.client!.send(command);
      return response.SessionId;
    } catch (error) {
      this.logger.error('Failed to create AWS Liveness session', error);
      throw error;
    }
  }

  async getLivenessResults(sessionId: string) {
    if (this.isMock) {
      this.logger.debug(`[MOCK REKOGNITION] Returning mock liveness results for session: ${sessionId}`);
      return {
        status: 'SUCCEEDED',
        confidence: 98.5,
        referenceImage: {
          Bytes: Buffer.from('mock-reference-image-bytes'),
        },
      };
    }

    try {
      const command = new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
      });
      const response = await this.client!.send(command);
      return {
        status: response.Status,
        confidence: response.Confidence,
        referenceImage: response.ReferenceImage,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get results for session ${sessionId}`,
        error,
      );
      throw error;
    }
  }

  async compareFaces(sourceImage: Buffer, targetImage: Buffer) {
    if (this.isMock) {
      this.logger.debug('[MOCK REKOGNITION] Comparing faces in mock mode -> Match: true (95.0%)');
      return {
        isMatch: true,
        similarity: 95.0,
      };
    }

    try {
      const command = new CompareFacesCommand({
        SourceImage: { Bytes: sourceImage },
        TargetImage: { Bytes: targetImage },
        SimilarityThreshold: Number(
          this.configService.get('KYC_MIN_SIMILARITY_SCORE', 80),
        ),
      });

      const response = await this.client!.send(command);
      const match = response.FaceMatches?.[0];

      return {
        isMatch: !!match,
        similarity: match?.Similarity || 0,
      };
    } catch (error) {
      this.logger.error('Face comparison error', error);
      throw error;
    }
  }
}
