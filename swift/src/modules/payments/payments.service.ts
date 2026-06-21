import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class PaymentsService {
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly headers: Record<string, string>;

  constructor(private config: ConfigService) {
    this.headers = {
      Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
      'Content-Type': 'application/json',
    };
  }

  // Step 1: Initialize a transaction — gives frontend a payment URL
  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    metadata?: Record<string, any>;
  }) {
    const { data } = await axios.post(
      `${this.baseUrl}/transaction/initialize`,
      {
        email: params.email,
        amount: params.amountKobo,
        reference: params.reference,
        metadata: params.metadata,
        callback_url: this.config.get<string>('PAYSTACK_CALLBACK_URL'),
      },
      { headers: this.headers },
    );
    return data.data; // { authorization_url, access_code, reference }
  }

  // Step 2: Verify payment after seeker pays
  async verifyTransaction(reference: string) {
    const { data } = await axios.get(
      `${this.baseUrl}/transaction/verify/${reference}`,
      { headers: this.headers },
    );
    if (data.data.status !== 'success') {
      throw new BadRequestException('Payment verification failed');
    }
    return data.data;
  }

  // Step 3: Create a transfer recipient (professional's bank account)
  async createTransferRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }) {
    const { data } = await axios.post(
      `${this.baseUrl}/transferrecipient`,
      {
        type: 'nuban',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: 'NGN',
      },
      { headers: this.headers },
    );
    return data.data; // { recipient_code }
  }

  // Step 4: Release escrow — transfer funds to professional
  async initiateTransfer(params: {
    amountKobo: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }) {
    const { data } = await axios.post(
      `${this.baseUrl}/transfer`,
      {
        source: 'balance',
        amount: params.amountKobo,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
      },
      { headers: this.headers },
    );
    return data.data; // { transfer_code, status }
  }

  // Step 5: Refund — reverse a charge
  async refundTransaction(transactionId: string, amountKobo?: number) {
    const { data } = await axios.post(
      `${this.baseUrl}/refund`,
      { transaction: transactionId, amount: amountKobo },
      { headers: this.headers },
    );
    return data.data;
  }

  // Utility: list banks for frontend dropdown
  async getBanks() {
    const { data } = await axios.get(
      `${this.baseUrl}/bank?currency=NGN`,
      { headers: this.headers },
    );
    return data.data;
  }

  generateReference(prefix = 'swift'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}