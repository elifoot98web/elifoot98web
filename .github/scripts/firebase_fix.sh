#!/bin/bash

sed -i -e 's/export interface DocumentSnapshotExists<T> extends firebase.firestore.DocumentSnapshot {/export interface DocumentSnapshotExists<T> extends firebase.firestore.DocumentSnapshot<T> {/g' 'node_modules/@angular/fire/compat/firestore/interfaces.d.ts'
sed -i -e 's/export interface QueryDocumentSnapshot<T> extends firebase.firestore.QueryDocumentSnapshot {/export interface QueryDocumentSnapshot<T> extends firebase.firestore.QueryDocumentSnapshot<T> {/g' 'node_modules/@angular/fire/compat/firestore/interfaces.d.ts'
sed -i -e 's/export interface QuerySnapshot<T> extends firebase.firestore.QuerySnapshot {/export interface QuerySnapshot<T> extends firebase.firestore.QuerySnapshot<T> {/g' 'node_modules/@angular/fire/compat/firestore/interfaces.d.ts'
sed -i -e 's/export interface DocumentChange<T> extends firebase.firestore.DocumentChange {/export interface DocumentChange<T> extends firebase.firestore.DocumentChange<T> {/g' 'node_modules/@angular/fire/compat/firestore/interfaces.d.ts'
echo "Firebase firestore typings fix for production build"
