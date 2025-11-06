class ConversationState {
  constructor() {
    this.states = new Map();
  }

  getState(phoneNumber) {
    if (!this.states.has(phoneNumber)) {
      this.states.set(phoneNumber, {
        step: 'idle',
        data: {}
      });
    }
    return this.states.get(phoneNumber);
  }

  setState(phoneNumber, updates) {
    const currentState = this.getState(phoneNumber);
    this.states.set(phoneNumber, {
      ...currentState,
      ...updates,
      data: {
        ...currentState.data,
        ...(updates.data || {})
      }
    });
  }

  resetState(phoneNumber) {
    this.states.set(phoneNumber, {
      step: 'idle',
      data: {}
    });
  }

  clearState(phoneNumber) {
    this.states.delete(phoneNumber);
  }
}

export default ConversationState;

