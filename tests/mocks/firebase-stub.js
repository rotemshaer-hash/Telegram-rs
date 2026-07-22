// Minimal fake window.firebase for smoke tests. Not a behavioral emulator —
// just enough surface area for index.html to boot, render its first screens,
// and exercise basic navigation without a real network/Firebase project.
(function () {
  function mockSnapshot(path) {
    return {
      exists: () => false,
      val: () => null,
      forEach: () => {},
      child: (p) => mockSnapshot(path + '/' + p),
      key: path.split('/').filter(Boolean).pop() || null,
      numChildren: () => 0,
    };
  }

  function mockRef(path) {
    const ref = {
      key: path.split('/').filter(Boolean).pop() || null,
      set: () => Promise.resolve(),
      update: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      get: () => Promise.resolve(mockSnapshot(path)),
      once: () => Promise.resolve(mockSnapshot(path)),
      on: (_event, cb) => {
        if (cb) setTimeout(() => cb(mockSnapshot(path)), 0);
        return cb;
      },
      off: () => {},
      push: () => {
        const key = 'mock_' + Math.random().toString(36).slice(2);
        const child = mockRef(path + '/' + key);
        return Object.assign(Promise.resolve(child), child, { key });
      },
      child: (p) => mockRef(path + '/' + p),
      limitToLast: () => ref,
      limitToFirst: () => ref,
      orderByChild: () => ref,
      orderByKey: () => ref,
      orderByValue: () => ref,
      equalTo: () => ref,
      startAt: () => ref,
      endAt: () => ref,
      transaction: (fn) => {
        const result = fn(null);
        return Promise.resolve({ committed: true, snapshot: mockSnapshot(path) , val: () => result });
      },
    };
    return ref;
  }

  const authState = { user: null, callbacks: [] };

  const authObj = {
    get currentUser() { return authState.user; },
    onAuthStateChanged(cb) {
      authState.callbacks.push(cb);
      setTimeout(() => cb(authState.user), 0);
      return () => {
        authState.callbacks = authState.callbacks.filter((c) => c !== cb);
      };
    },
    signInAnonymously() {
      authState.user = {
        uid: 'test_anon_' + Math.random().toString(36).slice(2),
        email: null,
        isAnonymous: true,
        getIdToken: () => Promise.resolve('mock-token'),
        updateProfile: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      authState.callbacks.forEach((cb) => cb(authState.user));
      return Promise.resolve({ user: authState.user });
    },
    createUserWithEmailAndPassword(email) {
      authState.user = {
        uid: 'test_uid_' + Math.random().toString(36).slice(2),
        email,
        isAnonymous: false,
        getIdToken: () => Promise.resolve('mock-token'),
        updateProfile: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      authState.callbacks.forEach((cb) => cb(authState.user));
      return Promise.resolve({ user: authState.user });
    },
    signInWithEmailAndPassword(email) {
      authState.user = { uid: 'test_uid_login', email, isAnonymous: false, getIdToken: () => Promise.resolve('mock-token') };
      authState.callbacks.forEach((cb) => cb(authState.user));
      return Promise.resolve({ user: authState.user });
    },
    signOut() {
      authState.user = null;
      authState.callbacks.forEach((cb) => cb(null));
      return Promise.resolve();
    },
  };

  window.firebase = {
    initializeApp: () => {},
    auth: () => authObj,
    database: () => ({ ref: mockRef }),
    storage: () => ({
      ref: () => ({
        put: () => Promise.resolve({ ref: { getDownloadURL: () => Promise.resolve('') } }),
        child: () => ({ put: () => Promise.resolve({ ref: { getDownloadURL: () => Promise.resolve('') } }) }),
        getDownloadURL: () => Promise.resolve(''),
      }),
    }),
    analytics: () => ({ logEvent: () => {} }),
  };
})();
