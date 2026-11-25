'use strict';

const { HttpError } = require('./firebase-runtime');

async function list(firestore, collection) {
  const snapshot = await firestore.collection(collection).get();
  return snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
}

async function query(firestore, collection, field, operator, value) {
  const snapshot = await firestore.collection(collection).where(field, operator, value).get();
  return snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
}

async function getById(firestore, collection, id) {
  const snapshot = await firestore.collection(collection).doc(String(id)).get();
  return snapshot.exists ? { ...snapshot.data(), _docId: snapshot.id } : null;
}

async function findOne(firestore, collection, field, value) {
  const snapshot = await firestore.collection(collection).where(field, '==', value).limit(1).get();
  return snapshot.empty ? null : { ...snapshot.docs[0].data(), _docId: snapshot.docs[0].id };
}

async function allocateId(firestore, collection) {
  const counter = firestore.collection('_meta').doc('counters');
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(counter);
    const current = snapshot.exists ? Number(snapshot.data()[collection]) : NaN;
    if (Number.isSafeInteger(current) && current >= 0) {
      transaction.update(counter, { [collection]: current + 1 });
      return current + 1;
    }
    const latest = await transaction.get(
      firestore.collection(collection).orderBy('id', 'desc').limit(1)
    );
    const next = latest.empty ? 1 : Number(latest.docs[0].data().id) + 1;
    transaction.set(counter, { [collection]: next }, { merge: true });
    return next;
  });
}

async function create(firestore, collection, data, id) {
  const recordId = id ?? await allocateId(firestore, collection);
  const value = { ...data, id: recordId };
  await firestore.collection(collection).doc(String(recordId)).create(value)
    .catch(error => {
      if (error.code === 6 || error.code === 'already-exists') {
        throw new HttpError(409, 'Record already exists');
      }
      throw error;
    });
  return value;
}

async function save(firestore, collection, id, data) {
  const ref = firestore.collection(collection).doc(String(id));
  const existing = await ref.get();
  if (!existing.exists) throw new HttpError(404, 'Record not found');
  await ref.set({ ...existing.data(), ...data, id: Number(id) }, { merge: true });
  return { ...existing.data(), ...data, id: Number(id) };
}

async function remove(firestore, collection, id) {
  const ref = firestore.collection(collection).doc(String(id));
  const existing = await ref.get();
  if (!existing.exists) throw new HttpError(404, 'Record not found');
  await ref.delete();
}

function sortIdDescending(items) {
  return items.sort((a, b) => Number(b.id) - Number(a.id));
}

module.exports = { allocateId, create, findOne, getById, list, query, remove, save, sortIdDescending };
