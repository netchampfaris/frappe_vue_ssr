<template>
  <div>
    <h1 class="text-red-500">Vue Page (Development Mode)</h1>

    <Button @click="workingMethod">Working Button</Button>
    <p>{{ message }}</p>

    <p>Count: {{ count }}</p>
    <Button @click="count++">Increment</Button>

    <LucidePlus />
  </div>
</template>

<script setup>
import { ref } from "vue";
import { Button } from "frappe-ui";
import "./vue-page.css";
import LucidePlus from "~icons/lucide/plus";

const count = ref(0);
const message = ref("Hello, Vue in Development Mode!");

const workingMethod = () => {
  console.log("This button works!");
  message.value = "Button clicked successfully!";
};
</script>
